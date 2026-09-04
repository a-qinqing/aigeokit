/**
 * Cloudflare Pages Function — GET /api/check-robots?url=<domain>
 *
 * Proxies a site's public robots.txt (browsers are usually CORS-blocked
 * from fetching third-party robots.txt directly), auto-completes protocol
 * and /robots.txt path, and returns the spec contract from robots功能2.txt:
 * raw_robots_txt, score (0-100 AI Crawlability), bots_status per monitored
 * AI crawler and GEO summaries — computed by the shared engine in
 * src/lib/robots.ts.
 *
 * Kept intentionally small: only this one edge function exists; the rest of
 * the site remains a static build.
 */

import { analyzeRobotsTxt } from '../../src/lib/robots';

const MAX_BYTES = 300_000; // generous: real robots.txt files are tiny
const FETCH_TIMEOUT_MS = 8_000;

type ApiErrorCode =
  | 'invalid-url'
  | 'no-robots'
  | 'not-robots-txt'
  | 'timeout'
  | 'unreachable';

interface ApiOk {
  ok: true;
  /** The URL actually requested (after protocol fallback). */
  url: string;
  final_url: string;
  http_status: number;
  content_type: string;
  size_bytes: number;
  truncated: boolean;
  /** Spec contract (robots功能2.txt): raw text, score, per-bot status, summary. */
  raw_robots_txt: string;
  score: number;
  bots_status: ReturnType<typeof analyzeRobotsTxt>['bots_status'];
  summary: string[];
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
 * path, port or protocol — we always request `https://<host>/robots.txt`. */
function parseHost(raw: string | null): { host: string } | { error: ApiErrorCode } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { error: 'invalid-url' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: 'invalid-url' };
  }

  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return { error: 'invalid-url' };

  // IP literals (v4/v6), localhost, and private-ish labels are not sites
  // anyone checks robots.txt for — reject them all up front.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { error: 'invalid-url' };
  if (host.includes(':') || host.includes('_')) return { error: 'invalid-url' };
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'invalid-url' };
  }
  // Single-label hosts (no dot) cannot be public websites.
  if (!host.includes('.')) return { error: 'invalid-url' };

  const labels = host.split('.');
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { error: 'invalid-url' };
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
  return fetch(`${protocol}//${host}/robots.txt`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': 'AIGEOKit-RobotsChecker/1.0 (+https://www.aigeokit.com/tools/ai-robots-txt-checker/)',
      accept: 'text/plain, */*;q=0.1',
    },
  });
}

export async function onRequestGet({
  request,
}: {
  request: Request;
}): Promise<Response> {
  const url = new URL(request.url);
  const parsed = parseHost(url.searchParams.get('url'));
  if ('error' in parsed) {
    return json({
      ok: false,
      error: parsed.error,
      message: 'Enter a valid public domain, e.g. example.com or https://example.com.',
    });
  }
  const { host } = parsed;

  // Most sites serve https; the plain-http retry rescues sites that never
  // migrated. A timeout is NOT retried (would double the wait).
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
    return json({ ok: false, error: 'no-robots', message: `${host} has no robots.txt (HTTP ${response.status}).` });
  }
  if (response.status < 200 || response.status >= 300) {
    return json({ ok: false, error: 'unreachable', message: `${host} answered with HTTP ${response.status}.` });
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('text/html')) {
    return json({ ok: false, error: 'not-robots-txt', message: `${host} returned an HTML page instead of robots.txt.` });
  }

  const { bytes, truncated } = await readCapped(response);
  const robotsText = decode(bytes);

  // Servers that lie about content-type: sniff for an HTML document.
  const head = robotsText.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return json({ ok: false, error: 'not-robots-txt', message: `${host} returned an HTML page instead of robots.txt.` });
  }

  const { score, bots_status, summary } = analyzeRobotsTxt(robotsText);

  return json({
    ok: true,
    url: `${usedScheme}://${host}/robots.txt`,
    final_url: response.url,
    http_status: response.status,
    content_type: contentType || 'text/plain',
    size_bytes: bytes.byteLength,
    truncated,
    raw_robots_txt: robotsText,
    score,
    bots_status,
    summary,
  });
}
