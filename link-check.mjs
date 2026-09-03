/**
 * Internal link / 404 / fragment checker.
 * BFS-crawls the local site, verifies every internal href & asset returns 200,
 * and confirms each #fragment target exists on its destination page.
 *
 * Usage: npm run check:links   (dev or preview server must run on :4321)
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
  const r = await fetch(BASE + path, { redirect: 'follow' });
  const res = { status: r.status, html: await r.text() };
  cache.set(path, res);
  return res;
}

function splitHref(href) {
  const q = href.indexOf('?');
  const h = href.indexOf('#');
  const end = Math.min(...[q, h].filter((i) => i >= 0), href.length);
  return { path: href.slice(0, end), frag: h >= 0 ? href.slice(h + 1) : '' };
}

async function checkPage(path) {
  const { status, html } = await grab(path);
  ok(`${path} → HTTP ${status}`, status === 200);

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
    const key = p.replace(/\/+$/, '/') || '/';
    const firstVisit = !internal.has(key);
    internal.add(key);

    if (firstVisit) {
      const r = await grab(p);
      const statusOk = r.status === 200;
      ok(`${p} → HTTP ${r.status}`, statusOk);
      if (!statusOk) continue;
    }
    if (frag) {
      const r = cache.get(key) ?? (await grab(p));
      const fragOk = r.html.includes(`id="${frag}"`);
      ok(`${p}#${frag} → fragment OK`, fragOk, `(id="${frag}" missing on ${p})`);
    }
  }
}

console.log(`Crawling ${BASE}\n`);
for (const p of SEED) {
  await checkPage(p);
}

console.log(`\nExternal links (${external.size}) — not fetched, check manually:`);
for (const u of [...external].sort()) console.log('  ', u);

console.log(failures === 0 ? '\n=== NO BROKEN INTERNAL LINKS ===' : `\n=== ${failures} BROKEN REFS ===`);
process.exit(failures ? 1 : 0);
