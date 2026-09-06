/**
 * Cloudflare Pages Function — GET /api/fetch-sitemap?url=<sitemap_url>
 *
 * Proxies a site's public XML sitemap for the llm.txt Builder import feature
 * (browsers are almost always CORS-blocked from fetching third-party sitemaps
 * directly). Same privacy posture as /api/check-robots: the URL goes only to
 * AIGEOKit's own first-party endpoint, nothing is logged or stored, and only
 * the sitemap XML itself is returned.
 *
 * Hardened on purpose: http(s) only, no credentials, no ports, no private or
 * local hosts, capped body, HTML and non-sitemap content rejected.
 */

const MAX_BYTES = 300_000; // generous: real sitemaps fit well under this
const FETCH_TIMEOUT_MS = 8_000;
const MAX_URL_LEN = 2_000;

type ApiErrorCode =
  | 'invalid-url'
  | 'not-found'
  | 'not-a-sitemap'
  | 'timeout'
  | 'unreachable';

interface ApiOk {
  ok: true;
  /** The URL actually requested. */
  url: string;
  final_url: string;
  http_status: number;
  content_type: string;
  size_bytes: number;
  truncated: boolean;
  /** Raw sitemap XML text, ready for client-side parsing. */
  xml_text: string;
}

interface ApiErr {
  ok: false;
  error: ApiErrorCode;
  message: string;
}

function json(body: ApiOk | ApiErr, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/**
 * Validate + normalize the user-supplied sitemap URL. Unlike the robots
 * endpoint (host-only) a full URL is legitimate here — sitemaps live at
 * arbitrary paths — so the sandboxing rules are applied to every part:
 * http(s) scheme, no userinfo, no port, public hostname only.
 */
function parseSitemapUrl(
  raw: string | null,
): { url: string } | { error: ApiErrorCode } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.length > MAX_URL_LEN) return { error: 'invalid-url' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: 'invalid-url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'invalid-url' };
  }
  if (url.username || url.password || url.port) return { error: 'invalid-url' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return { error: 'invalid-url' };

  // IP literals (v4/v6), localhost, and private-ish labels are not public
  // sitemap hosts — reject them all up front.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { error: 'invalid-url' };
  if (host.includes(':') || host.includes('_')) return { error: 'invalid-url' };
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'invalid-url' };
  }
  if (!host.includes('.')) return { error: 'invalid-url' };

  const labels = host.split('.');
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { error: 'invalid-url' };
    }
  }
  return { url: url.href };
}

/** Read the body up to MAX_BYTES; marks truncation instead of failing. */
async function readCapped(
  response: Response,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = MAX_BYTES - total;
    if (value.length > room) {
      chunks.push(value.subarray(0, room));
      total += room;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return { bytes: merged, truncated };
}

/** UTF-8 first; fall back to ISO-8859-1 when decoding produced U+FFFD. */
function decode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('iso-8859-1').decode(bytes);
}

async function tryFetch(url: string): Promise<Response> {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': 'AIGEOKit-LlmsTxtBuilder/1.0 (+https://www.aigeokit.com/tools/llm-txt-builder/)',
      accept: 'application/xml, text/xml, application/atom+xml, */*;q=0.1',
    },
  });
}

export async function onRequestGet({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseSitemapUrl(url.searchParams.get('url'));
  if ('error' in parsed) {
    return json({
      ok: false,
      error: 'invalid-url',
      message: 'Enter a public sitemap URL, e.g. https://example.com/sitemap.xml',
    });
  }
  const target = parsed.url;

  // https first; a connection-level failure on plain-http is retried over
  // https (many hosts upgraded after their sitemaps were linked as http).
  // Timeouts are NOT retried (would double the wait).
  let response: Response;
  try {
    response = await tryFetch(target);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'timeout', message: `The sitemap did not respond within ${FETCH_TIMEOUT_MS / 1000}s.` });
    }
    if (target.startsWith('http://')) {
      try {
        response = await tryFetch(target.replace(/^http:/, 'https:'));
      } catch (err2) {
        if (err2 instanceof DOMException && err2.name === 'TimeoutError') {
          return json({ ok: false, error: 'timeout', message: `The sitemap did not respond within ${FETCH_TIMEOUT_MS / 1000}s.` });
        }
        return json({ ok: false, error: 'unreachable', message: `Could not reach ${target}.` });
      }
    } else {
      return json({ ok: false, error: 'unreachable', message: `Could not reach ${target}.` });
    }
  }

  if (response.status === 404 || response.status === 410) {
    return json({ ok: false, error: 'not-found', message: `${target} returned HTTP ${response.status} — no sitemap at that URL.` });
  }
  if (response.status < 200 || response.status >= 300) {
    return json({ ok: false, error: 'unreachable', message: `${target} answered with HTTP ${response.status}.` });
  }

  const contentType = response.headers.get('content-type') ?? '';
  const { bytes, truncated } = await readCapped(response);
  const xmlText = decode(bytes);

  // Reject HTML outright, then require actual sitemap markers — a sitemap
  // may legally be served as text/plain, so sniff rather than trust the header.
  const head = xmlText.slice(0, 500).trimStart().toLowerCase();
  if (
    contentType.toLowerCase().includes('text/html') ||
    head.startsWith('<!doctype html') ||
    head.startsWith('<html')
  ) {
    return json({ ok: false, error: 'not-a-sitemap', message: `${target} returned an HTML page, not a sitemap. Did you mean .../sitemap.xml?` });
  }
  if (!/<\s*(urlset|sitemapindex)(\s|>)/i.test(xmlText.slice(0, 50_000))) {
    return json({ ok: false, error: 'not-a-sitemap', message: `${target} did not return XML sitemap content (<urlset> or <sitemapindex> not found).` });
  }

  return json({
    ok: true,
    url: target,
    final_url: response.url,
    http_status: response.status,
    content_type: contentType || 'application/xml',
    size_bytes: bytes.byteLength,
    truncated,
    xml_text: xmlText,
  });
}
