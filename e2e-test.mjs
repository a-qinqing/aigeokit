/**
 * Full E2E self-test of the AIGEOKit site using system Edge via playwright-core.
 *
 * Part A — homepage portal: SEO meta, header/nav, tools-suite grid (1 live card
 *   linking to /tools/schema-generator/ + 3 Coming Soon), GEO guide, footer.
 * Part B — /tools/schema-generator/: page load & SEO head, tool switching,
 *   form→output reactivity, FAQ row add/remove, GEO checklist, platform tabs,
 *   clipboard copy, modal open/close/Esc, quick-copy, load-example/clear,
 *   and console errors.
 */
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:4321/';
const TOOL = `${BASE}tools/schema-generator/`;

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failures++;
};

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label = 'until', tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await fn()) return true;
    } catch (e) {
      console.log(`  [eval error in ${label}]: ${e.message.split('\n')[0]}`);
    }
    await wait(100);
  }
  ok(label, false, '(timeout)');
  return false;
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// The site uses CSS smooth-scroll; in headless automation the scroll animation
// races with Playwright's click coordinates. Disable it for deterministic clicks.
const noSmooth = () => page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });

/* ============ Part A — homepage (brand page) ============ */

await page.goto(BASE, { waitUntil: 'networkidle' });
await noSmooth();

ok('home title', (await page.title()) === 'Free AI & GEO Tools | Optimize Your Site for SearchGPT & Perplexity');
ok('home description meta', (await page.locator('meta[name="description"]').getAttribute('content')).includes('100% free AI & GEO toolkit'));
ok('home canonical', (await page.locator('link[rel="canonical"]').getAttribute('href')) === 'https://www.aigeokit.com/');
ok('home og:title meta', (await page.locator('meta[property="og:title"]').getAttribute('content')).includes('Free AI & GEO Tools'));
const homeJsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
ok('home JSON-LD: WebApplication + Organization', homeJsonLd.some((s) => s.includes('"WebApplication"')) && homeJsonLd.some((s) => s.includes('"Organization"')));
ok('home h1', (await page.locator('#top h1').textContent()).includes('Get Cited by AI Search Engines'));
ok('nav links Tools(/tools/) & Guide', (await page.locator('body > header nav a[href="/tools/"]').count()) === 1 && (await page.locator('body > header nav a[href="/#guide"]').count()) === 1);
ok('header brand badge', (await page.locator('body > header').textContent()).includes('100% Client-Side · Free Forever'));
ok('hero CTA to tools + guide', (await page.locator('#top a[href="/tools/"]').count()) === 1 && (await page.locator('#top a[href="/#guide"]').count()) === 1);
ok('featured tool section', (await page.locator('#featured').count()) === 1);
ok('featured links generator + directory', (await page.locator('#featured a[href="/tools/schema-generator/"]').count()) === 1 && (await page.locator('#featured a[href="/tools/"]').count()) === 1);
ok('home has no 4-card portal grid', (await page.locator('.portal-card').count()) === 0);
ok('guide section present', (await page.locator('#guide h2').textContent()).includes('Why AI Search Engines'));
ok('guide links to generator', (await page.locator('#guide a[href^="/tools/schema-generator"]').count()) >= 1);
ok('footer brand', (await page.locator('body > footer').textContent()).includes('AIGEOKit'));
ok('home has no tool form', (await page.locator('#schema-form').count()) === 0);

/* ============ Part A2 — /tools/ tools directory ============ */

await page.goto(`${BASE}tools/`, { waitUntil: 'networkidle' });
await noSmooth();

ok('directory title', (await page.title()) === 'Free GEO & AI SEO Tools Suite | AIGEOKit');
ok('directory canonical', (await page.locator('link[rel="canonical"]').getAttribute('href')) === 'https://www.aigeokit.com/tools/');
ok('directory h1', (await page.locator('h1').filter({ hasText: 'Free AI & GEO Webmaster Tools Suite' }).count()) === 1);
const dirJsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
ok('directory ItemList JSON-LD', dirJsonLd.some((s) => s.includes('"ItemList"')) && dirJsonLd.some((s) => s.includes('"numberOfItems":4')));
ok('directory portal grid: 4 cards', (await page.locator('.portal-card').count()) === 4);
ok('directory 1 live + 3 coming-soon', (await page.locator('.portal-live').count()) === 1 && (await page.locator('.portal-soon').count()) === 3);
ok('directory live card links to tool page', (await page.locator('.portal-live').first().getAttribute('href')) === '/tools/schema-generator/');
ok('directory grid header', (await page.locator('#tools h2').textContent()) === 'Tools Directory');
ok('directory FAQ has 3 items', (await page.locator('#faq h3').count()) === 3);
ok('directory footer brand', (await page.locator('body > footer').textContent()).includes('AIGEOKit'));

/* ============ Part B — /tools/schema-generator/ functional suite ============ */

await page.goto(TOOL, { waitUntil: 'networkidle' });
await noSmooth();

/* B0. Page load & SEO head */
ok('tool page title', (await page.title()) === 'Free Article JSON-LD Schema Generator & GEO Checklist | AIGEOKit');
ok('tool description meta', (await page.locator('meta[name="description"]').getAttribute('content')).includes('Test your GEO Readiness score for SearchGPT'));
ok('tool canonical', (await page.locator('link[rel="canonical"]').getAttribute('href')) === 'https://www.aigeokit.com/tools/schema-generator/');
const toolJsonLd = await page.locator('script[type="application/ld+json"]').allTextContents();
ok('tool JSON-LD: WebApplication + BreadcrumbList', toolJsonLd.some((s) => s.includes('"WebApplication"')) && toolJsonLd.some((s) => s.includes('"BreadcrumbList"')));
ok('tool breadcrumb UI (Home/Tools)', (await page.locator('nav[aria-label="Breadcrumb"]').count()) === 1 && (await page.locator('nav[aria-label="Breadcrumb"] a[href="/"]').count()) === 1 && (await page.locator('nav[aria-label="Breadcrumb"] a[href="/tools/"]').count()) === 1);
ok('tool breadcrumb current item', (await page.locator('nav[aria-label="Breadcrumb"] [aria-current="page"]').textContent()) === 'Schema Generator');
ok('tool h1', (await page.locator('h1').filter({ hasText: 'Free Article JSON-LD Schema Generator' }).count()) === 1);
ok('header nav to tools directory', (await page.locator('body > header nav a[href="/tools/"]').count()) === 1);
ok('8 tool cards', (await page.locator('.tool-card').count()) === 8);
ok('default Article form rendered', await page.locator('#schema-form input[data-field="headline"]').isVisible());

/* B1. Live reactivity: headline → output + checklist */
const headlineInput = page.locator('#schema-form input[data-field="headline"]');
await headlineInput.fill('E2E TEST HEADLINE 42');
ok('output updates on typing', await until(async () => {
  const code = await page.locator('#output-code').textContent();
  return code.includes('E2E TEST HEADLINE 42');
}));
ok('checklist renders items', (await page.locator('#checklist-list li').count()) > 3);
ok('checklist score present', (await page.locator('#checklist-score').textContent()) !== '–/–');

/* B2. Checklist expand on click */
ok('checklist recommendation expands', await until(async () => {
  // Explicit center-scroll + fixed mouse click: the right column is a sticky
  // container, and Playwright's auto-scroll mis-locates inside it. A real user
  // scrolls first and clicks — which this simulates deterministically.
  await page.evaluate(() =>
    document.querySelector('.check-item .check-head').scrollIntoView({ block: 'center' }),
  );
  await wait(50);
  const box = await page.locator('.check-head').first().boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await wait(100);
  return page
    .locator('.check-item .check-reco')
    .first()
    .evaluate((el) => !el.classList.contains('hidden'));
}));

/* B3. Platform tabs */
await page.locator('.platform-tab[data-platform="wordpress"]').click();
ok('WordPress tab shows script tag', await until(async () => {
  const code = await page.locator('#output-code').textContent();
  return code.includes('<script type="application/ld+json">');
}));
ok('WP JSON escaped (no raw < in body)', await page.locator('#output-code').evaluate((el) => {
  const body = el.textContent.replace(/^<script[^>]*>\n/, '').replace(/\n<\/script>$/, '');
  return !/<[^s]/.test(body);
}));
await page.locator('.platform-tab[data-platform="shopify"]').click();
ok('Shopify tab shows liquid', await until(async () => {
  const code = await page.locator('#output-code').textContent();
  return code.includes('geo_schema') && code.includes('{%- assign');
}));
await page.locator('.platform-tab[data-platform="raw"]').click();

/* B4. Tool switching: FAQ with dynamic rows */
await page.locator('.tool-card[data-tool="faq"]').click();
ok('FAQ form has repeat rows', (await page.locator('.repeat-row').count()) >= 3);
ok('tool name updates', (await page.locator('#form-tool-name').textContent()) === 'FAQ');
const before = await page.locator('.repeat-row').count();
await page.locator('.add-row').first().click();
ok('FAQ add row works', (await page.locator('.repeat-row').count()) === before + 1);
await page.locator('.remove-row').first().click();
ok('FAQ remove row works', (await page.locator('.repeat-row').count()) === before);

/* B5. Organization tool + org schema output */
await page.locator('.tool-card[data-tool="organization"]').click();
ok('Organization has sameAs rows', (await page.locator('.repeat-row').count()) >= 1);
ok('org output has sameAs+knowsAbout context', await until(async () => {
  const code = await page.locator('#output-code').textContent();
  return code.includes('"sameAs"');
}));

/* B6. Copy → modal */
await page.locator('.platform-tab[data-platform="wordpress"]').click();
await page.locator('#copy-btn').click();
ok('modal opens after copy', await until(async () => {
  return await page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex'));
}));
ok('modal success title', (await page.locator('#modal-title').textContent()) === 'Code Copied to Clipboard!');
ok('modal recommendation heading', (await page.locator('#modal-recs h3').textContent()).includes('WordPress or Shopify'));
ok('modal has 2 affiliate buttons', (await page.locator('#modal-recs a').count()) === 2);
ok('clipboard holds code', await until(async () => {
  const clip = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null; // permission denied in this context — treat as unknown
    }
  });
  if (clip === null) return false;
  // Windows normalizes LF → CRLF in the system clipboard; normalize before comparing.
  const code = await page.locator('#output-code').textContent();
  return clip.replace(/\r/g, '') === code;
}));

/* B7. Esc closes modal */
await page.keyboard.press('Escape');
ok('Esc closes modal', await until(async () => {
  return !(await page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
}));

/* B8. Reopen + backdrop close */
await page.locator('#copy-btn').click();
await until(async () => page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
await page.locator('#modal-backdrop').click({ position: { x: 5, y: 5 } });
ok('backdrop click closes modal', await until(async () => {
  return !(await page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
}));

/* B9. Reopen + Close (Esc) text button + quick-copy switches platform */
await page.locator('#copy-btn').click();
await until(async () => page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
await page.locator('[data-quick-copy="shopify"]').click();
ok('quick-copy switches to Shopify', await until(async () => {
  const label = await page.locator('#modal-platform').textContent();
  return label.includes('Shopify');
}));
ok('quick-copy re-copies', await until(async () => {
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  return clip.includes('geo_schema');
}));
await page.locator('#modal-close-text').click();
ok('Close (Esc) button closes modal', await until(async () => {
  return !(await page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
}));

/* B10. Copy again button */
await page.locator('#copy-btn').click();
await until(async () => page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
await page.locator('#modal-copy-again').click();
ok('copy again keeps modal open', await page.locator('#copy-modal').evaluate((el) => el.classList.contains('flex')));
await page.keyboard.press('Escape');

/* B11. Load example / Clear */
await page.locator('.tool-card[data-tool="article"]').click();
await page.locator('#load-example').click();
ok('load example fills form', await until(async () => {
  const v = await page.locator('#schema-form input[data-field="headline"]').inputValue();
  return v.length > 5;
}));
await page.locator('#clear-form').click();
ok('clear empties form', await until(async () => {
  const v = await page.locator('#schema-form input[data-field="headline"]').inputValue();
  return v === '';
}));
ok('checklist reflects empty state (has fails)', await until(async () => {
  const list = await page.locator('#checklist-list').textContent();
  return list.includes('fail') || (await page.locator('#checklist-score').textContent()).startsWith('0/');
}));

/* B12. All 8 tools render a form without error */
let allToolsOk = true;
for (const id of ['article', 'faq', 'product', 'organization', 'person', 'localbusiness', 'breadcrumb', 'howto']) {
  await page.locator(`.tool-card[data-tool="${id}"]`).click();
  await wait(80);
  const fields = await page.locator('#schema-form [data-field], #schema-form .repeat-row').count();
  if (fields === 0) allToolsOk = false;
}
ok('all 8 tools render forms', allToolsOk);

/* B13. Console errors */
ok('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
console.log(failures === 0 ? '\n=== ALL E2E TESTS PASSED ===' : `\n=== ${failures} FAILURES ===`);
process.exit(failures ? 1 : 0);
