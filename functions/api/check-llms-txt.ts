/**
 * Cloudflare Pages Function — GET /api/check-llms-txt?host=<domain>
 *
 * Proxies a site's public /llms.txt for the "Verify Live llms.txt" checker
 * on the llm.txt Builder page (browsers cannot read third-party /llms.txt
 * directly due to CORS). Same privacy posture as /api/check-robots and
 * /api/fetch-sitemap: the request goes only to AIGEOKit's own first-party
 * endpoint, nothing is logged or stored, and only the file text is returned.
 *
 * Hardened the same way: public hostname only (no IPs, no ports, no local
 * hosts), fixed /llms.txt path, capped body, HTML content rejected.
 */

const MAX_BYTES = 100_000; // llms.txt files are small; generous cap
const FETCH_TIMEOUT_MS = 8_000;

type ApiErrorCode =
  | 'invalid-host'
  | 'no-file'
  | 'not-llms'
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
  /** Raw llms.txt text, ready for client-side validation. */
  text: string;
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

/** Validate + normalize the user-supplied host. Never lets a caller pick a
 * path, port or protocol — we always request `https://<host>/llms.txt`. */
function parseHost(raw: string | null): { host: string } | { error: ApiErrorCode } {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (!trimmed) return { error: 'invalid-host' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: 'invalid-host' };
  }

  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return { error: 'invalid-host' };

  // IP literals (v4/v6), localhost, and private-ish labels are not sites
  // anyone deploys a public llms.txt on — reject them all up front.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { error: 'invalid-host' };
  if (host.includes(':') || host.includes('_')) return { error: 'invalid-host' };
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'invalid-host' };
  }
  if (!host.includes('.')) return { error: 'invalid-host' };

  const labels = host.split('.');
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { error: 'invalid-host' };
    }
  }
  return { host };
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

async function tryFetch(host: string, protocol: 'https:' | 'http:'): Promise<Response> {
  return fetch(`${protocol}//${host}/llms.txt`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': 'AIGEOKit-LiveLlmsCheck/1.0 (+https://www.aigeokit.com/tools/llm-txt-builder/)',
      accept: 'text/plain, text/markdown, */*;q=0.1',
    },
  });
}

export async function onRequestGet({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseHost(url.searchParams.get('host'));
  if ('error' in parsed) {
    return json({
      ok: false,
      error: 'invalid-host',
      message: 'Enter a valid public domain, e.g. example.com or https://example.com.',
    });
  }
  const { host } = parsed;

  // https first; the plain-http retry rescues sites that never migrated.
  // A timeout is NOT retried (would double the wait).
  let usedScheme: 'https' | 'http' = 'https';
  let response: Response;
  try {
    response = await tryFetch(host, 'https:');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'timeout', message: `${host} did not respond within ${FETCH_TIMEOUT_MS / 1000}s.` });
    }
    try {
      usedScheme = 'http';
      response = await tryFetch(host, 'http:');
    } catch (err2) {
      if (err2 instanceof DOMException && err2.name === 'TimeoutError') {
        return json({ ok: false, error: 'timeout', message: `${host} did not respond within ${FETCH_TIMEOUT_MS / 1000}s.` });
      }
      return json({ ok: false, error: 'unreachable', message: `Could not reach ${host}.` });
    }
  }

  if (response.status === 404 || response.status === 410) {
    return json({ ok: false, error: 'no-file', message: `${host} has no /llms.txt (HTTP ${response.status}).` });
  }
  if (response.status < 200 || response.status >= 300) {
    return json({ ok: false, error: 'unreachable', message: `${host} answered with HTTP ${response.status}.` });
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('text/html')) {
    return json({ ok: false, error: 'not-llms', message: `${host} returned an HTML page instead of a plain-text llms.txt.` });
  }

  const { bytes, truncated } = await readCapped(response);
  const text = decode(bytes);

  // Servers that lie about content-type: sniff for an HTML document.
  const head = text.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return json({ ok: false, error: 'not-llms', message: `${host} returned an HTML page instead of a plain-text llms.txt.` });
  }

  return json({
    ok: true,
    url: `${usedScheme}://${host}/llms.txt`,
    final_url: response.url,
    http_status: response.status,
    content_type: contentType || 'text/plain',
    size_bytes: bytes.byteLength,
    truncated,
    text,
  });
}
