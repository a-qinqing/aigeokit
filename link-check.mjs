/**
 * Internal link / 404 / fragment checker.
 * BFS-crawls the local site, verifies every internal href & asset returns 200,
 * and confirms each #fragment target exists on its destination page.
 *
 * Usage: node link-check.mjs   (dev or preview server must run on :4321)
 */
const BASE = process.env.E2E_BASE || 'http://localhost:4321';
const SEED = ['/', '/tools/', '/tools/schema-generator/'];

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failures++;
};

const external = new Set();
const internal = new Set();
const cache = new Map(); // path → { status, html }

async function grab(path) {
  if (cache.has(path)) return cache.get(path);
  // manual: surface 3xx so non-canonical internal links are reported instead
  // of being silently followed to their final URL.
  const r = await fetch(BASE + path, { redirect: 'manual' });
  const res = {
    status: r.status,
    location: r.headers.get('location') || '',
    type: r.headers.get('content-type') || '',
    html: await r.text(),
  };
  cache.set(path, res);
  return res;
}

function splitHref(href) {
  const q = href.indexOf('?');
  const h = href.indexOf('#');
  const end = Math.min(...[q, h].filter((i) => i >= 0), href.length);
  return { path: href.slice(0, end), frag: h >= 0 ? href.slice(h + 1) : '' };
}

async function checkPage(path, queue) {
  const { status, html, type } = await grab(path);
  ok(`${path} → HTTP ${status}`, status === 200);
  if (status !== 200 || !type.includes('text/html')) return;

  // every link / asset on this page
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);

  for (const raw of refs) {
    if (/^(mailto:|tel:|data:|javascript:)/i.test(raw)) continue;
    let target = raw;
    let basePath = path;
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      if (u.origin === new URL(BASE).origin) {
        target = u.pathname + u.search + u.hash;
      } else {
        external.add(raw);
        continue;
      }
    } else if (raw.startsWith('/')) {
      // absolute path (all site links are absolute)
    } else if (raw.startsWith('#')) {
      // same-page fragment — check against this page's ids below
      target = path + raw;
    } else {
      continue; // skip relative oddities (none expected)
    }

    const { path: p, frag } = splitHref(target);
    if (!p || p === path) {
      // same-page fragment: verify id exists in this html
      if (frag) {
        ok(`#${frag} exists on ${path}`, html.includes(`id="${frag}"`));
      }
      continue;
    }
    // Dedupe on the exact URL: /geo-audit and /geo-audit/ are different
    // requests, and the non-canonical one must still be checked.
    const key = p;
    const firstVisit = !internal.has(key);
    internal.add(key);

    if (firstVisit) {
      const r = await grab(p);
      const statusOk = r.status === 200;
      const redirected = r.status >= 300 && r.status < 400;
      const redirectNote = redirected && r.location ? ` → ${r.location}` : '';
      ok(
        `${p} → HTTP ${r.status}${redirectNote}`,
        statusOk,
        redirected ? '(internal link redirects — point it at the final URL)' : '',
      );
      if (!statusOk) continue;
      // Local preview serves /route and /route/ alike, while Cloudflare Pages
      // 308-redirects the extensionless form. If the trailing-slash variant is
      // also a page, /route is non-canonical even though it returned 200 here.
      if (!p.endsWith('/') && !(p.split('/').pop() || '').includes('.')) {
        const alias = await grab(p + '/');
        if (alias.status === 200 && alias.type.includes('text/html')) {
          ok(`${p} → non-canonical page URL`, false, `(use ${p}/)`);
          queue.push(p + '/');
        }
      }
      // Crawl linked HTML pages too, so links deeper in the site are covered.
      if (r.type.includes('text/html')) queue.push(p);
    }
    if (frag) {
      const r = cache.get(key) ?? (await grab(p));
      const fragOk = r.html.includes(`id="${frag}"`);
      ok(`${p}#${frag} → fragment OK`, fragOk, `(id="${frag}" missing on ${p})`);
    }
  }
}

console.log(`Crawling ${BASE}\n`);
const queue = [...SEED];
const crawled = new Set();
while (queue.length > 0) {
  const path = queue.shift();
  if (crawled.has(path)) continue;
  crawled.add(path);
  await checkPage(path, queue);
}

console.log(`\nExternal links (${external.size}) — not fetched, check manually:`);
for (const u of [...external].sort()) console.log('  ', u);

console.log(failures === 0 ? '\n=== NO BROKEN INTERNAL LINKS ===' : `\n=== ${failures} BROKEN REFS ===`);
// Set the code instead of process.exit(): exiting while fetch handles are
// still open can trip a libuv assertion on Windows.
process.exitCode = failures ? 1 : 0;
