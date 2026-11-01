/**
 * Cloudflare Pages Function — GET /api/visibility-check?url=<domain>
 *
 * L1 AI Visibility Checker backend. Fetches the public homepage, robots.txt,
 * llms.txt and sitemap.xml, then runs the shared scoring engine in
 * src/lib/visibility.ts.
 *
 * Privacy posture matches the other edge endpoints: the URL goes only to
 * AIGEOKit's first-party endpoint, the files are read and discarded, and the
 * report is cached for six hours in Cloudflare's cache (no database, no KV).
 *
 * Hardened on purpose: public hostname only (no IPs, ports, credentials,
 * local hosts), fixed paths (plus a robots-declared sitemap), capped bodies,
 * HTML rejected where a text/XML file is expected.
 */

import { analyzeVisibility } from '../../src/lib/visibility';
import type { VisibilityReport } from '../../src/lib/visibility';

// 200KB keeps the HTML parse comfortably inside the Workers free-tier CPU
// budget (~5–7ms); larger pages are truncated and flagged in the report.
const HTML_MAX_BYTES = 200_000;
const FILE_MAX_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_SECONDS = 21_600; // 6 hours

const UA = 'AIGEOKit-VisibilityChecker/1.0 (+https://www.aigeokit.com/ai-visibility-checker/)';

type ApiErrorCode =
  | 'invalid-url'
  | 'unreachable'
  | 'timeout'
  | 'blocked'
  | 'no-html'
  | 'parse-failed';

interface ApiOk {
  ok: true;
  url: string;
  final_url: string;
  fetched_at: string;
  report: VisibilityReport;
}

interface ApiErr {
  ok: false;
  error: ApiErrorCode;
  message: string;
}

interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function json(body: ApiOk | ApiErr, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

/* ------------------------------ URL parsing ----------------------------- */

/** Validate + normalize a user-supplied host. Only public hostnames pass. */
function parseHost(raw: string | null): { host: string } | { error: ApiErrorCode } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { error: 'invalid-url' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: 'invalid-url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid-url' };
  if (url.username || url.password) return { error: 'invalid-url' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return { error: 'invalid-url' };

  // IP literals (v4/v6), localhost, and private-ish labels are not public sites.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { error: 'invalid-url' };
  if (host.includes(':') || host.includes('_')) return { error: 'invalid-url' };
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    return { error: 'invalid-url' };
  }
  if (host.endsWith('.localhost') || host.endsWith('.test') || host.endsWith('.invalid')) {
    return { error: 'invalid-url' };
  }
  if (!host.includes('.')) return { error: 'invalid-url' };

  const labels = host.split('.');
  for (const label of labels) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return { error: 'invalid-url' };
  }
  return { host };
}

function isPublicUrl(url: URL): boolean {
  const parsed = parseHost(url.hostname);
  return 'host' in parsed;
}

/* -------------------------------- Fetching ------------------------------- */

/** Read a response body up to `maxBytes`; truncation is reported, not fatal. */
async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
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
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: decode(merged), truncated };
}

/** UTF-8 first; fall back to ISO-8859-1 when decoding produced U+FFFD. */
function decode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('iso-8859-1').decode(bytes);
}

async function fetchOnce(
  url: string,
  accept: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'user-agent': UA,
      accept,
    },
  });
}

class TimeoutError extends Error {}

/** HTTPS first, then plain HTTP for sites that never migrated. */
async function fetchWithFallback(url: URL, accept: string): Promise<{ response: Response; finalUrl: string }> {
  const httpsUrl = new URL(url.toString());
  httpsUrl.protocol = 'https:';
  try {
    const response = await fetchOnce(httpsUrl.toString(), accept);
    return { response, finalUrl: response.url || httpsUrl.toString() };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new TimeoutError();
    const httpUrl = new URL(url.toString());
    httpUrl.protocol = 'http:';
    try {
      const response = await fetchOnce(httpUrl.toString(), accept);
      return { response, finalUrl: response.url || httpUrl.toString() };
    } catch (err2) {
      if (err2 instanceof DOMException && err2.name === 'TimeoutError') throw new TimeoutError();
      throw err2;
    }
  }
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 300).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

interface FileResult {
  status: number | null;
  text: string | null;
  url: string;
}

/** Fetch an optional public file. 404/HTML/unreachable all become a null body. */
async function fetchOptionalFile(
  url: string,
  accept: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<FileResult> {
  try {
    const response = await fetchOnce(url, accept, timeoutMs);
    const status = response.status;
    if (status < 200 || status >= 300) return { status, text: null, url };

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html')) return { status, text: null, url };

    const { text } = await readCapped(response, FILE_MAX_BYTES);
    if (looksLikeHtml(text)) return { status, text: null, url };
    return { status, text, url };
  } catch {
    return { status: null, text: null, url };
  }
}

/** `Sitemap:` directives from robots.txt, in declaration order. */
function declaredSitemaps(robots: string): string[] {
  const urls: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (match?.[1]) urls.push(match[1]);
  }
  return urls;
}

/** A robots-declared sitemap is only usable when it points at a public URL. */
function publicSitemapUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return isPublicUrl(url) ? url.toString() : null;
  } catch {
    return null;
  }
}

/* -------------------------------- Handler -------------------------------- */

export async function onRequestGet(context: {
  request: Request;
  waitUntil?: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const { request, waitUntil } = context;
  const requestUrl = new URL(request.url);
  const parsed = parseHost(requestUrl.searchParams.get('url'));
  if ('error' in parsed) {
    return json({
      ok: false,
      error: parsed.error,
      message: 'Enter a valid public website, e.g. example.com or https://example.com.',
    });
  }
  const { host } = parsed;

  /* ----- Cache: one report per host for six hours ----- */
  const cacheStore = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
  const useCache = cacheStore && requestUrl.searchParams.get('fresh') !== '1';
  const cacheUrl = new URL(requestUrl.toString());
  cacheUrl.search = '';
  cacheUrl.searchParams.set('url', host);
  cacheUrl.searchParams.set('__visibility_cache', '1');
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  if (useCache) {
    try {
      const hit = await cacheStore.match(cacheKey);
      if (hit) {
        const headers = new Headers(hit.headers);
        headers.set('x-visibility-cache', 'hit');
        return new Response(await hit.text(), { status: hit.status, headers });
      }
    } catch {
      // Cache is an optimization; never fail the request because of it.
    }
  }

  /* ----- Homepage ----- */
  const homepageUrl = new URL(`https://${host}/`);
  let homepage: { response: Response; finalUrl: string };
  try {
    homepage = await fetchWithFallback(homepageUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1');
  } catch (err) {
    if (err instanceof TimeoutError) {
      return json({
        ok: false,
        error: 'timeout',
        message: `${host} did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`,
      });
    }
    return json({
      ok: false,
      error: 'unreachable',
      message: `Could not reach ${host}. The site may be offline or blocking automated requests.`,
    });
  }

  const homepageStatus = homepage.response.status;
  if (homepageStatus === 401 || homepageStatus === 403 || homepageStatus === 429) {
    return json({
      ok: false,
      error: 'blocked',
      message: `${host} blocked the checker (HTTP ${homepageStatus}). Try again later or analyze a different URL.`,
    });
  }
  if (homepageStatus < 200 || homepageStatus >= 300) {
    return json({
      ok: false,
      error: 'unreachable',
      message: `${host} answered with HTTP ${homepageStatus}.`,
    });
  }

  let finalUrl: URL;
  try {
    finalUrl = new URL(homepage.finalUrl || homepageUrl.toString());
  } catch {
    return json({ ok: false, error: 'unreachable', message: `Could not resolve the final URL for ${host}.` });
  }
  if (!isPublicUrl(finalUrl)) {
    return json({ ok: false, error: 'invalid-url', message: 'The site redirected to a non-public address.' });
  }

  const contentType = (homepage.response.headers.get('content-type') ?? '').toLowerCase();
  const { text: html, truncated } = await readCapped(homepage.response, HTML_MAX_BYTES);
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml') && !looksLikeHtml(html)) {
    return json({
      ok: false,
      error: 'no-html',
      message: `${host} did not return an HTML page (content-type: ${contentType || 'unknown'}).`,
    });
  }

  /* ----- robots.txt / llms.txt / sitemap.xml (parallel) ----- */
  const origin = finalUrl.origin;
  const [robots, llms, conventionalSitemap] = await Promise.all([
    fetchOptionalFile(`${origin}/robots.txt`, 'text/plain,*/*;q=0.1'),
    fetchOptionalFile(`${origin}/llms.txt`, 'text/plain,*/*;q=0.1'),
    fetchOptionalFile(`${origin}/sitemap.xml`, 'application/xml,text/xml,*/*;q=0.1'),
  ]);

  // WordPress/Yoast and friends often live at /sitemap_index.xml and only
  // advertise it through robots.txt. Try the declared URL when the
  // conventional path did not return a usable file.
  let sitemap = conventionalSitemap;
  if (!sitemap.text && robots.text) {
    const declared = declaredSitemaps(robots.text)
      .map(publicSitemapUrl)
      .find((url): url is string => Boolean(url));
    if (declared) {
      const fallback = await fetchOptionalFile(
        declared,
        'application/xml,text/xml,*/*;q=0.1',
        4_000,
      );
      if (fallback.text) sitemap = fallback;
    }
  }

  /* ----- Score ----- */
  const xRobotsTag = homepage.response.headers.get('x-robots-tag');
  const fetchedAt = new Date().toISOString();

  let report: VisibilityReport;
  try {
    report = analyzeVisibility({
      url: `${new URL(homepageUrl).protocol}//${host}/`,
      finalUrl: finalUrl.toString(),
      html,
      htmlTruncated: truncated,
      robotsText: robots.text,
      robotsStatus: robots.status,
      llmsText: llms.text,
      llmsStatus: llms.status,
      sitemapText: sitemap.text,
      sitemapStatus: sitemap.status,
      sitemapUrl: sitemap.text ? sitemap.url : null,
      xRobotsTag,
      fetchedAt,
    });
  } catch (err) {
    console.error('visibility-check analysis failed', err);
    return json({
      ok: false,
      error: 'parse-failed',
      message: `We could not analyze the HTML returned by ${host}.`,
    });
  }

  const body: ApiOk = {
    ok: true,
    url: `${new URL(homepageUrl).protocol}//${host}/`,
    final_url: finalUrl.toString(),
    fetched_at: fetchedAt,
    report,
  };

  const response = json(body, 200, {
    'cache-control': `public, max-age=${CACHE_SECONDS}`,
  });

  if (useCache) {
    try {
      const put = cacheStore.put(cacheKey, response.clone());
      if (waitUntil) waitUntil(put);
      else await put;
    } catch {
      // Cache writes are best-effort.
    }
  }

  return response;
}
