/**
 * llms.txt Builder & Validator — page controller.
 *
 * Owns the builder form state (describe site → curate pages → sitemap import
 * via local XML parse or AIGEOKit's /api/fetch-sitemap proxy), drives the
 * live preview pane from the shared engine in llmsBuilder.ts, and runs the
 * paste-in validator view. Everything runs client-side; no user content is
 * ever sent to a third party.
 *
 * All element ids are prefixed `llms-` to stay globally unique.
 */

import {
  buildLlmsTxt,
  parseSitemapXml,
  stateIssues,
  urlToTitle,
  validateLlmsTxt,
} from './llmsBuilder';
import type { IssueSeverity, LlmsPage, LlmsIssue } from './llmsBuilder';

/* ------------------------------ DOM helpers ----------------------------- */

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  );
}

/* ------------------------------- Elements ------------------------------- */

const form = $('llms-form') as HTMLFormElement;
const siteName = $('llms-site-name') as HTMLInputElement;
const summary = $('llms-summary') as HTMLTextAreaElement;
const details = $('llms-details') as HTMLTextAreaElement;
const llmsFull = $('llms-llmsfull') as HTMLInputElement;
const pageRows = $('llms-page-rows');
const sitemapPaste = $('llms-sitemap-paste') as HTMLTextAreaElement;
const sitemapUrl = $('llms-sitemap-url') as HTMLInputElement;
const importStatus = $('llms-import-status');
const previewMeta = $('llms-preview-meta');
const previewIssues = $('llms-preview-issues');
const previewPre = $('llms-preview-pre');
const valPaste = $('llms-val-paste') as HTMLTextAreaElement;
const valOut = $('llms-val-out');
const creditInput = $('llms-credit') as HTMLInputElement;
const sitemapExampleBtn = $('llms-sitemap-example');
const smPanelPaste = $('llms-sm-panel-paste');
const smPanelUrl = $('llms-sm-panel-url');
const liveDomain = $('llms-live-domain') as HTMLInputElement;
const liveCheckBtn = $('llms-live-check') as HTMLButtonElement;
const liveStatus = $('llms-live-status');

/* ------------------------------- State ---------------------------------- */

const MAX_PAGES = 3000; // keep rows & preview cheap on huge sitemaps
const MAX_CHILD_SITEMAPS = 20;

interface State {
  siteName: string;
  summary: string;
  details: string;
  llmsFull: string;
  pages: LlmsPage[];
  /** Append the `<!-- Generated with AIGEOKit … -->` comment to exports. */
  credit: boolean;
}

const state: State = {
  siteName: '',
  summary: '',
  details: '',
  llmsFull: '',
  pages: [],
  credit: true,
};

let importBusy = false;
let liveBusy = false;

/* --------------------------- Sitemap mode tabs -------------------------- */

const SM_TAB_ON = ['bg-mint-500', 'text-ink-950'];
const SM_TAB_OFF = ['text-sand-300', 'hover:bg-ink-800', 'hover:text-mint-300'];

let smMode: 'paste' | 'url' = 'paste';

function paintTab(tab: HTMLElement, on: boolean): void {
  for (const c of (on ? SM_TAB_ON : SM_TAB_OFF)) tab.classList.add(c);
  for (const c of (on ? SM_TAB_OFF : SM_TAB_ON)) tab.classList.remove(c);
}

function setSmMode(next: 'paste' | 'url'): void {
  if (smMode === next) return;
  smMode = next;
  smPanelPaste.classList.toggle('hidden', next !== 'paste');
  smPanelUrl.classList.toggle('hidden', next !== 'url');
  for (const [tab, mode] of [
    [$('llms-sm-tab-paste'), 'paste'],
    [$('llms-sm-tab-url'), 'url'],
  ] as const) {
    paintTab(tab, mode === next);
  }
}

/** Draw the user back to paste mode after a remote fetch was blocked. */
function fallbackToPaste(): void {
  setSmMode('paste');
  sitemapPaste.focus();
  sitemapPaste.style.outline = '2px solid rgba(251, 191, 36, 0.55)';
  sitemapPaste.style.outlineOffset = '2px';
  window.setTimeout(() => {
    sitemapPaste.style.outline = '';
    sitemapPaste.style.outlineOffset = '';
  }, 2600);
}

const emptyPage = (): LlmsPage => ({ url: '', title: '', description: '' });

/* ------------------------------ Status UI ------------------------------- */

const TONE_CLS: Record<'err' | 'ok' | 'warn' | 'muted', string> = {
  err: 'text-red-300',
  ok: 'text-mint-300',
  warn: 'text-amber-300',
  muted: 'text-sand-500',
};

function setImportStatus(
  message: string,
  tone: keyof typeof TONE_CLS = 'muted',
): void {
  importStatus.textContent = message;
  importStatus.className = `mt-2.5 min-h-[1rem] text-xs ${TONE_CLS[tone]}`;
}

/* ------------------------------ Row rendering --------------------------- */

const rowInputCls =
  'w-full rounded-lg border border-ink-600/70 bg-ink-900 px-3 py-2 text-sm text-sand-100 ' +
  'placeholder:text-sand-500 focus:border-mint-400 focus:outline-none transition-colors';

function rowHtml(page: LlmsPage, i: number): string {
  return `
    <div class="page-row grid grid-cols-1 gap-2 rounded-xl border border-ink-600 bg-ink-900/60 p-3 md:grid-cols-2" data-i="${i}">
      <input type="text" data-f="url" autocomplete="off" spellcheck="false"
             value="${esc(page.url)}" placeholder="https://example.com/page/"
             class="${rowInputCls} font-mono text-[13px]" aria-label="Page URL" />
      <input type="text" data-f="title" autocomplete="off" spellcheck="false"
             value="${esc(page.title)}" placeholder="Page title"
             class="${rowInputCls}" aria-label="Page title" />
      <input type="text" data-f="description" autocomplete="off" spellcheck="false"
             value="${esc(page.description)}" placeholder="Optional: one-line description"
             class="${rowInputCls} md:col-span-2" aria-label="Optional description" />
      <button type="button" data-rm aria-label="Remove page"
              class="justify-self-end rounded-md px-2 py-1 text-xs text-sand-500 transition-colors hover:text-red-400">
        ✕ Remove
      </button>
    </div>`;
}

function renderRows(): void {
  pageRows.innerHTML =
    state.pages.map(rowHtml).join('') ||
    '<p class="text-xs text-sand-500">No pages yet — add one manually or import your sitemap below.</p>';
}

/* ----------------------------- Live preview ----------------------------- */

const ISSUE_CHIP: Record<IssueSeverity, string> = {
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  suggestion: 'border-ink-600 bg-ink-900/70 text-sand-400',
};

const ISSUE_LABEL: Record<IssueSeverity, string> = {
  error: 'Error',
  warn: 'Warning',
  suggestion: 'Tip',
};

function issueChipHtml(issue: LlmsIssue): string {
  const tone = ISSUE_CHIP[issue.severity];
  return `
    <div class="flex items-start gap-2.5 rounded-xl border border-ink-700 bg-ink-900/50 px-3.5 py-2.5">
      <span class="mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}">
        ${ISSUE_LABEL[issue.severity]}
      </span>
      <p class="text-xs leading-relaxed text-sand-400">${esc(issue.message)}</p>
    </div>`;
}

function renderPreview(): void {
  const content = buildLlmsTxt(state);
  previewPre.textContent = content;
  const lines = content.trim() ? content.split('\n').length : 0;
  previewMeta.textContent = `${content.length.toLocaleString()} chars · ${lines} lines`;

  const issues = stateIssues(state);
  if (issues.length === 0) {
    previewIssues.innerHTML = `
      <div class="flex items-start gap-2.5 rounded-xl border border-mint-500/25 bg-mint-500/5 px-3.5 py-2.5">
        <span class="mt-0.5 text-mint-400">✓</span>
        <p class="text-xs leading-relaxed text-sand-300">
          Well-formed — matches the llmstxt.org layout. Copy it or download the file.
        </p>
      </div>`;
  } else {
    previewIssues.innerHTML = issues.map(issueChipHtml).join('');
  }
}

/* ------------------------------- Actions -------------------------------- */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / older browsers.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function flashCopied(btn: HTMLButtonElement): void {
  const prev = btn.textContent;
  btn.textContent = '✓ Copied';
  btn.dataset.copied = 'true';
  setTimeout(() => {
    if (btn.dataset.copied === 'true') {
      btn.textContent = prev;
      btn.dataset.copied = '';
    }
  }, 1600);
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------------------- Sitemap import ---------------------------- */

function setBusy(busy: boolean): void {
  importBusy = busy;
  ($('llms-import-paste') as HTMLButtonElement).disabled = busy;
  const urlBtn = $('llms-import-url') as HTMLButtonElement;
  urlBtn.disabled = busy;
  if (!busy) urlBtn.textContent = URL_BTN_LABEL;
}

/** Append imported sitemap <loc> URLs as pages (auto-titled, de-duplicated). */
function mergeLocations(locs: string[], sourceNote: string): void {
  const existing = new Set(state.pages.map((p) => p.url.trim()));
  let added = 0;
  let skipped = 0;
  for (const loc of locs) {
    if (existing.has(loc)) {
      skipped++;
      continue;
    }
    if (state.pages.length >= MAX_PAGES) {
      skipped++;
      continue;
    }
    state.pages.push({ url: loc, title: urlToTitle(loc), description: '' });
    existing.add(loc);
    added++;
  }
  if (added > 0) {
    renderRows();
    renderPreview();
    const overCap = state.pages.length >= MAX_PAGES ? ' (page cap reached)' : '';
    setImportStatus(
      `Added ${added} page${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''}${overCap} — titles are auto-derived, edit them as needed.${sourceNote}`,
      'ok',
    );
  } else {
    setImportStatus(
      `No new pages added — all ${skipped} URL${skipped === 1 ? ' was' : 's were'} already on the list.`,
      'warn',
    );
  }
}

function importPastedXml(): void {
  const xml = sitemapPaste.value.trim();
  if (!xml) {
    setImportStatus('Paste sitemap XML content first — copy it from your sitemap.xml file.', 'err');
    return;
  }
  const parsed = parseSitemapXml(xml);
  if (!parsed.ok) {
    setImportStatus(
      parsed.error === 'empty'
        ? 'No http(s) <loc> URLs found in that XML.'
        : 'That does not look like valid sitemap XML — paste raw <urlset> or <sitemapindex> content.',
      'err',
    );
    return;
  }
  if (parsed.kind === 'sitemapindex') {
    setImportStatus(
      `This is a sitemap index with ${parsed.locs.length} child sitemap${parsed.locs.length === 1 ? '' : 's'} — child pages can’t be fetched from pasted text. Paste a child sitemap’s XML, or use “Fetch sitemap URL” above to follow them automatically.`,
      'warn',
    );
    return;
  }
  mergeLocations(parsed.locs, ' Parsed 100% locally — nothing was sent anywhere.');
}

type FetchTag = 'invalid-url' | 'not-found' | 'not-a-sitemap' | 'timeout' | 'unreachable' | 'network';

type FetchResult =
  | { ok: true; xml: string; truncated?: boolean }
  | { ok: false; tag: FetchTag; message: string };

/**
 * Fetch a sitemap (or child sitemap) through the AIGEOKit first-party proxy.
 * Failures carry a `tag` so the caller can tell "URL was wrong" apart from
 * "the target site blocked or mangled the request" — the latter routes the
 * user to paste mode with the dedicated guidance copy.
 */
async function fetchSitemap(url: string): Promise<FetchResult> {
  let payload: { ok: boolean; message: string; xml_text?: string; truncated?: boolean; error?: string };
  try {
    const res = await fetch(`/api/fetch-sitemap?url=${encodeURIComponent(url)}`);
    payload = (await res.json()) as typeof payload;
  } catch {
    return { ok: false, tag: 'network', message: 'Sitemap fetch failed — check the URL, or paste the XML instead.' };
  }
  if (!payload.ok) {
    // error codes come from the edge function contract
    const titles: Record<string, string> = {
      'invalid-url': 'That URL is not allowed — use a public http(s) sitemap URL.',
      'not-found': 'No sitemap found at that URL (HTTP 404/410) — double-check the sitemap address.',
      'not-a-sitemap': 'That URL did not return an XML sitemap (the site may be serving an HTML block page).',
      timeout: 'The site did not respond in time — it may be throttling automated fetches.',
      unreachable: 'Could not reach that host — it may be firewalled or offline.',
    };
    return { ok: false, tag: (payload.error as FetchTag) ?? 'unreachable', message: titles[payload.error ?? ''] ?? payload.message };
  }
  return { ok: true, xml: payload.xml_text ?? '', truncated: payload.truncated };
}

/** Copy shown when a remote fetch was blocked by the target site. */
const FETCH_BLOCKED_COPY =
  'Unable to fetch remote sitemap due to target site restrictions. Please paste the XML text directly instead.';

/** Site-side failures (network, WAF/html block pages, timeouts) → paste mode. */
const BLOCKED_TAGS: ReadonlySet<string> = new Set(['network', 'unreachable', 'timeout', 'not-a-sitemap']);

const URL_BTN_LABEL = 'Fetch sitemap URL';

function importSitemapUrl(): void {
  const url = sitemapUrl.value.trim();
  if (!url) {
    setImportStatus('Enter a sitemap URL first, e.g. https://example.com/sitemap.xml', 'err');
    return;
  }
  if (importBusy) return;
  setBusy(true);
  void (async () => {
    setImportStatus('⏳ Fetching sitemap… (fetched by AIGEOKit’s own proxy; nothing is stored)', 'muted');
    const first = await fetchSitemap(url);
    if (!first.ok) {
      if (BLOCKED_TAGS.has(first.tag)) {
        // Target site firewalled/throttled/served an HTML block page —
        // graceful fallback per spec: dedicated copy + focus paste mode.
        setImportStatus(`${FETCH_BLOCKED_COPY} (${first.message})`, 'err');
        fallbackToPaste();
      } else {
        setImportStatus(first.message, 'err');
      }
      setBusy(false);
      return;
    }
    const parsed = parseSitemapXml(first.xml);
    if (!parsed.ok) {
      setImportStatus(
        parsed.error === 'empty'
          ? 'The fetched file contained no http(s) <loc> URLs.'
          : 'The fetched file is not valid sitemap XML.',
        'err',
      );
      setBusy(false);
      return;
    }

    if (parsed.kind === 'urlset') {
      mergeLocations(parsed.locs, first.truncated ? ' Note: the file was large and may have been truncated.' : '');
      setBusy(false);
      return;
    }

    // Sitemap index → follow each child through the proxy, sequentially.
    const children = parsed.locs.slice(0, MAX_CHILD_SITEMAPS);
    const skippedChildren = parsed.locs.length - children.length;
    let addedCount = 0;
    for (let i = 0; i < children.length; i++) {
      setImportStatus(`Following child sitemap ${i + 1}/${children.length}…`, 'muted');
      const child = await fetchSitemap(children[i]);
      if (!child.ok) continue;
      const childParsed = parseSitemapXml(child.xml ?? '');
      if (!childParsed.ok || childParsed.kind !== 'urlset') continue;
      const before = state.pages.length;
      mergeLocations(childParsed.locs, '');
      addedCount += state.pages.length - before;
      // mergeLocations re-renders rows each time; that is fine at this scale.
      await new Promise((r) => setTimeout(r, 30)); // let the status label paint
    }
    if (skippedChildren > 0) {
      setImportStatus(
        `${addedCount} page${addedCount === 1 ? '' : 's'} imported from ${children.length} child sitemap${children.length === 1 ? '' : 's'} (${skippedChildren} more sitemap${skippedChildren === 1 ? '' : 's'} not followed — the limit is ${MAX_CHILD_SITEMAPS}).`,
        'ok',
      );
    } else {
      setImportStatus(
        `${addedCount} page${addedCount === 1 ? '' : 's'} imported across ${children.length} child sitemap${children.length === 1 ? '' : 's'}.`,
        'ok',
      );
    }
    setBusy(false);
  })();
}

/* ---------------------------- Example / clear --------------------------- */

/** Preset sitemap for the "Load example sitemap" button (fictional domain). */
const EXAMPLE_SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.org/</loc></url>
  <url><loc>https://example.org/about/</loc></url>
  <url><loc>https://example.org/pricing/</loc></url>
  <url><loc>https://example.org/features/</loc></url>
  <url><loc>https://example.org/docs/</loc></url>
  <url><loc>https://example.org/contact/</loc></url>
</urlset>`;

/**
 * Load an example sitemap into the paste box and import it immediately, so
 * the preview renders a well-formed llms.txt in one click. On an empty form
 * the site header is filled too — otherwise the example rows simply append.
 */
function loadSitemapExample(): void {
  if (!state.siteName.trim()) {
    state.siteName = 'Example — widgets & SaaS';
    state.summary =
      'Example is a fictional SaaS company used to demonstrate a standard llms.txt layout.';
    state.details = '';
    state.llmsFull = '';
    siteName.value = state.siteName;
    summary.value = state.summary;
    details.value = '';
    llmsFull.value = '';
  }
  sitemapPaste.value = EXAMPLE_SITEMAP_XML;
  setSmMode('paste');
  sitemapPaste.focus();
  importPastedXml();
}

function loadExample(): void {
  state.siteName = 'AIGEOKit';
  state.summary =
    'AIGEOKit is a free, privacy-first toolbox of AI & GEO webmaster tools — JSON-LD schema generation, AI crawler checks and llms.txt files — for ranking and getting cited in AI search engines like SearchGPT, Perplexity and Claude.';
  state.details =
    '## What you can do here\nGenerate JSON-LD schema, test AI crawler access and build an llms.txt file — every tool runs in your browser and costs nothing.';
  state.llmsFull = '';
  state.pages = [
    {
      url: 'https://www.aigeokit.com/',
      title: 'AIGEOKit Homepage',
      description: 'Free GEO toolkit: get recommended by SearchGPT, Perplexity & AI Overviews',
    },
    {
      url: 'https://www.aigeokit.com/tools/',
      title: 'Tools Directory',
      description: 'The full suite of free AI & GEO tools',
    },
    {
      url: 'https://www.aigeokit.com/tools/schema-generator/',
      title: 'JSON-LD Schema Generator & GEO Checklist',
      description: 'Generate Article, FAQ, Product and Organization schema with a live GEO Readiness score',
    },
    {
      url: 'https://www.aigeokit.com/tools/ai-robots-txt-checker/',
      title: 'AI Robots.txt Checker',
      description: 'Test GPTBot, PerplexityBot and ClaudeBot access with a 0-100 AI Crawlability Score',
    },
    {
      url: 'https://www.aigeokit.com/tools/llm-txt-builder/',
      title: 'Free llms.txt Generator & Validator',
      description: 'Build and validate standard llms.txt files for AI search engines',
    },
  ];
  siteName.value = state.siteName;
  summary.value = state.summary;
  details.value = state.details;
  llmsFull.value = state.llmsFull;
  renderRows();
  renderPreview();
}

function clearAll(): void {
  state.siteName = '';
  state.summary = '';
  state.details = '';
  state.llmsFull = '';
  state.credit = true;
  state.pages = [emptyPage()];
  siteName.value = '';
  summary.value = '';
  details.value = '';
  llmsFull.value = '';
  creditInput.checked = true;
  sitemapPaste.value = '';
  sitemapUrl.value = '';
  setImportStatus('', 'muted');
  renderRows();
  renderPreview();
}

/* ------------------------------- Validator ------------------------------ */

const VAL_CHIP: Record<'found' | 'missing', string> = {
  found: 'bg-mint-500/15 text-mint-300 border-mint-500/30',
  missing: 'bg-red-500/15 text-red-300 border-red-500/30',
};

function validatorChip(label: string, found: boolean, detail: string): string {
  return `
    <span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${VAL_CHIP[found ? 'found' : 'missing']}">
      ${found ? '✓' : '✗'} ${esc(label)} <span class="font-normal opacity-70">· ${esc(detail)}</span>
    </span>`;
}

function validatePasted(): void {
  const text = valPaste.value;
  if (!text.trim()) {
    valOut.innerHTML = `
      <div role="alert" class="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <p class="text-sm font-bold text-red-300">Nothing to validate</p>
        <p class="mt-1 text-[13px] leading-relaxed text-red-200/80">Paste the contents of your llms.txt file first — or generate one above and copy it over.</p>
      </div>`;
    return;
  }

  const lines = text.split(/\r?\n/);
  const counts = {
    title: lines.some((l) => /^#\s+/.test(l.trim())),
    summary: lines.some((l) => /^>\s?/.test(l.trim())),
    h2: lines.filter((l) => /^##\s+/.test(l.trim())).length,
    links: lines.filter((l) => /^-\s+\[[^\]]*\]\(/.test(l.trim())).length,
  };

  const issues = validateLlmsTxt(text);
  const chips = `
    <div class="flex flex-wrap gap-1.5">
      ${validatorChip('H1 title', counts.title, counts.title ? 'found' : 'missing')}
      ${validatorChip('Summary', counts.summary, counts.summary ? 'found' : 'missing')}
      <span class="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-[11px] font-semibold text-sand-300">
        H2 sections <span class="font-normal opacity-70">· ${counts.h2}</span>
      </span>
      <span class="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-[11px] font-semibold text-sand-300">
        Links <span class="font-normal opacity-70">· ${counts.links}</span>
      </span>
      <span class="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-[11px] font-semibold text-sand-300">
        ${text.split('\n').length} lines
      </span>
    </div>`;

  const issuesHtml =
    issues.length === 0
      ? `
        <div class="rounded-xl border border-mint-500/25 bg-mint-500/5 px-4 py-3.5">
          <p class="text-sm font-bold text-mint-300">✓ Valid llms.txt — no problems found</p>
          <p class="mt-1 text-xs leading-relaxed text-sand-400">
            The file follows the llmstxt.org structure: H1 title, blockquote summary, optional H2 sections and clean markdown links.
          </p>
        </div>`
      : issues
          .map(
            (issue) => `
        <div class="rounded-xl border border-ink-700 bg-ink-900/50 p-3.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ISSUE_CHIP[issue.severity]}">
              ${ISSUE_LABEL[issue.severity]}
            </span>
            <p class="min-w-0 flex-1 text-[13px] leading-relaxed text-sand-200">
              ${esc(issue.message)}
              ${issue.line ? `<span class="ml-1 font-mono text-[11px] text-sand-500">line ${issue.line}</span>` : ''}
            </p>
          </div>
          ${issue.fix ? `<p class="mt-1.5 text-xs leading-relaxed text-sand-500"><span class="font-semibold text-mint-300">Fix:</span> ${esc(issue.fix)}</p>` : ''}
        </div>`,
          )
          .join('');

  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarn = issues.some((i) => i.severity === 'warn');
  const verdict = hasError
    ? '<p class="text-xs font-bold text-red-300">✗ Fixes required before deploy.</p>'
    : hasWarn
      ? '<p class="text-xs font-bold text-amber-300">✓ Deployable — fix the warnings for best results.</p>'
      : issues.length > 0
        ? '<p class="text-xs font-bold text-mint-300">✓ Valid llms.txt — the tips below are optional.</p>'
        : '';

  valOut.innerHTML = `
    <div class="space-y-3">
      ${chips}
      ${issuesHtml}
      ${verdict}
      <p class="text-[11px] leading-relaxed text-sand-500">
        Validated 100% in your browser — the file never leaves your device.
      </p>
    </div>`;
}

/* ------------------------- Verify live llms.txt ------------------------ */

const LIVE_BTN_LABEL = 'Check Live';

interface LiveApiOk {
  ok: true;
  url: string;
  http_status: number;
  size_bytes: number;
  truncated: boolean;
  text: string;
}

interface LiveApiErr {
  ok: false;
  error: string;
  message: string;
}

/** Strict client-side domain normalization (mirrors the edge function). */
function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/\.$/, '');
  if (!host || host.includes(' ') || host.includes('_') || host.includes(':')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // no IP literals
  if (!host.includes('.')) return null;
  return host;
}

function liveAlert(tone: 'red' | 'amber' | 'mint', title: string, detail: string, backToBuilder = false): void {
  const toneCls =
    tone === 'red'
      ? 'border-red-500/30 bg-red-500/10'
      : tone === 'amber'
        ? 'border-amber-500/25 bg-amber-500/10'
        : 'border-mint-500/25 bg-mint-500/5';
  const textCls = tone === 'red' ? 'text-red-300' : tone === 'amber' ? 'text-amber-300' : 'text-mint-300';
  liveStatus.innerHTML = `
    <div role="alert" class="rounded-xl border px-4 py-3.5 ${toneCls}">
      <p class="text-sm font-bold ${textCls}">${esc(title)}</p>
      <p class="mt-1 text-[13px] leading-relaxed text-sand-400">${esc(detail)}</p>
      ${
        backToBuilder
          ? `<a href="#builder" class="mt-2.5 inline-block rounded-lg bg-mint-500 px-3.5 py-1.5 text-xs font-bold text-ink-950 transition-colors hover:bg-mint-400">Generate llms.txt above ↑</a>`
          : ''
      }
    </div>`;
}

async function runLiveCheck(): Promise<void> {
  if (liveBusy) return;
  const host = normalizeDomain(liveDomain.value);
  if (!host) {
    liveAlert(
      'red',
      'That does not look like a public domain',
      'For example: example.com — or paste https://example.com/llms.txt. IP addresses, local hosts and paths are not supported.',
    );
    return;
  }

  liveBusy = true;
  liveCheckBtn.disabled = true;
  liveCheckBtn.textContent = '⏳ Checking…';
  liveStatus.innerHTML = `
    <p class="flex items-center gap-2 text-sm text-sand-400">
      <span class="h-2 w-2 animate-pulse rounded-full bg-mint-400"></span>
      Checking https://${esc(host)}/llms.txt…
    </p>`;

  let payload: LiveApiOk | LiveApiErr;
  try {
    const res = await fetch(`/api/check-llms-txt?host=${encodeURIComponent(host)}`);
    payload = (await res.json()) as LiveApiOk | LiveApiErr;
  } catch {
    liveAlert(
      'red',
      'Live check unavailable',
      'The /api/check-llms-txt edge function could not be reached. Please try again in a moment.',
    );
    liveBusy = false;
    liveCheckBtn.disabled = false;
    liveCheckBtn.textContent = LIVE_BTN_LABEL;
    return;
  }

  liveBusy = false;
  liveCheckBtn.disabled = false;
  liveCheckBtn.textContent = LIVE_BTN_LABEL;

  if (!payload.ok) {
    const titles: Record<string, [string, string]> = {
      'no-file': [
        'No /llms.txt deployed at that domain',
        `https://${host}/llms.txt answered HTTP 404 — the file has not been published yet. Generate one in the builder and upload it to your site root.`,
      ],
      'not-llms': [
        'That URL served an HTML page',
        `https://${host}/llms.txt did not return a plain-text llms.txt file — serve the file as text, not a rendered webpage.`,
      ],
      timeout: [
        'The site did not respond in time',
        'It may block automated fetches. Try again, or open the URL in your browser to verify it manually.',
      ],
      unreachable: [
        'Could not reach that host',
        'The site may be offline or firewalled. Try again, or verify https://' + host + '/llms.txt in a browser.',
      ],
    };
    const [title, detail] = titles[payload.error] ?? ['Live check failed', payload.message];
    liveAlert('amber', title, detail, payload.error === 'no-file');
    return;
  }

  if (payload.http_status !== 200) {
    liveAlert(
      'amber',
      `Unexpected HTTP ${payload.http_status}`,
      `https://${host}/llms.txt answered with HTTP ${payload.http_status} — expected 200.`,
    );
    return;
  }

  // Success: HTTP 200 → summarize size + validate the fetched structure locally.
  const text = payload.text;
  const lines = text.split(/\r?\n/);
  const counts = {
    title: lines.some((l) => /^#\s+\S/.test(l.trim())),
    summary: lines.some((l) => /^>\s?/.test(l.trim())),
    h2: lines.filter((l) => /^##\s+/.test(l.trim())).length,
    links: lines.filter((l) => /^-\s+\[[^\]]*\]\(/.test(l.trim())).length,
  };
  const issues = validateLlmsTxt(text);
  const errors = issues.filter((i) => i.severity === 'error').slice(0, 3);

  liveStatus.innerHTML = `
    <div class="rounded-xl border border-mint-500/25 bg-mint-500/5 px-4 py-3.5">
      <p class="text-sm font-bold text-mint-300">✓ HTTP 200 — a live llms.txt is being served</p>
      <p class="mt-1 font-mono text-[11px] leading-relaxed text-sand-500">
        https://${esc(host)}/llms.txt · ${payload.size_bytes.toLocaleString()} bytes · ${lines.length} lines${
          payload.truncated ? ' (preview truncated)' : ''
        }
      </p>
    </div>
    <div class="flex flex-wrap gap-1.5">
      ${validatorChip('H1 title', counts.title, counts.title ? 'found' : 'missing')}
      ${validatorChip('Summary', counts.summary, counts.summary ? 'found' : 'missing')}
      <span class="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-[11px] font-semibold text-sand-300">
        H2 sections <span class="font-normal opacity-70">· ${counts.h2}</span>
      </span>
      <span class="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-[11px] font-semibold text-sand-300">
        Links <span class="font-normal opacity-70">· ${counts.links}</span>
      </span>
    </div>
    ${
      errors.length === 0
        ? `<div class="rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
             <p class="text-xs font-semibold text-mint-300">✓ Live file structure looks valid — no errors detected.</p>
           </div>`
        : `<div class="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
             <p class="text-xs font-semibold text-red-300">✗ Structure errors found in the live file:</p>
             <ul class="mt-1.5 space-y-1">
               ${errors.map((e) => `<li class="text-xs leading-relaxed text-red-200/80">line ${e.line ?? '—'}: ${esc(e.message)}</li>`).join('')}
             </ul>
             <p class="mt-1.5 text-[11px] text-sand-500">Fix the file locally with the builder or validator above, then re-upload.</p>
           </div>`
    }
    <p class="text-[11px] leading-relaxed text-sand-500">
      Checked through the AIGEOKit first-party proxy — nothing is logged or stored.
    </p>`;
}

/* -------------------------------- Wiring -------------------------------- */

form.addEventListener('submit', (e) => e.preventDefault());

// Sitemap mode tabs (Paste XML default; URL mode switches in on demand).
function paintSmTabs(): void {
  for (const [tabId, mode] of [
    ['llms-sm-tab-paste', 'paste'],
    ['llms-sm-tab-url', 'url'],
  ] as const) {
    paintTab($(tabId), mode === smMode);
  }
}

document.querySelectorAll<HTMLButtonElement>('.llms-sm-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    setSmMode((tab.dataset.smMode as 'paste' | 'url') ?? 'paste');
  });
});

// Live fields → state (title/summary/details/llms-full).
for (const [field, el] of [
  ['siteName', siteName],
  ['summary', summary],
  ['details', details],
  ['llmsFull', llmsFull],
] as const) {
  el.addEventListener('input', () => {
    state[field] = el.value;
    renderPreview();
  });
}

// Page rows: keystroke updates land in the row identified by data-i.
pageRows.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const field = t.dataset.f;
  if (!field) return;
  const rowEl = t.closest<HTMLElement>('.page-row');
  const idx = Number(rowEl?.dataset.i);
  if (!rowEl || Number.isNaN(idx) || !state.pages[idx]) return;
  state.pages[idx][field as keyof LlmsPage] = t.value;
  renderPreview();
});

pageRows.addEventListener('click', (e) => {
  const rm = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rm]');
  if (!rm) return;
  const idx = Number(rm.closest<HTMLElement>('.page-row')?.dataset.i);
  if (Number.isNaN(idx)) return;
  state.pages.splice(idx, 1);
  if (state.pages.length === 0) state.pages.push(emptyPage());
  renderRows();
  renderPreview();
});

$('llms-add-page').addEventListener('click', () => {
  state.pages.push(emptyPage());
  renderRows();
  renderPreview();
  const urls = pageRows.querySelectorAll<HTMLInputElement>('input[data-f="url"]');
  urls[urls.length - 1]?.focus();
});

$('llms-load-example').addEventListener('click', loadExample);
$('llms-clear').addEventListener('click', clearAll);
$('llms-import-paste').addEventListener('click', importPastedXml);
$('llms-import-url').addEventListener('click', importSitemapUrl);
$('llms-val-run').addEventListener('click', validatePasted);

// Enter in the sitemap URL box triggers the fetch.
sitemapUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    importSitemapUrl();
  }
});

$('llms-copy').addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const ok = await copyText(buildLlmsTxt(state));
  if (ok) flashCopied(btn);
  else btn.textContent = 'Copy failed — select manually';
});

$('llms-download').addEventListener('click', () => {
  downloadText('llms.txt', buildLlmsTxt(state));
});

// Attribution comment toggle drives preview + copy/download instantly.
creditInput.addEventListener('change', () => {
  state.credit = creditInput.checked;
  renderPreview();
});

// Load example sitemap: fills the paste box and imports immediately.
sitemapExampleBtn.addEventListener('click', loadSitemapExample);

// Live deployment checker.
liveCheckBtn.addEventListener('click', () => void runLiveCheck());
liveDomain.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    void runLiveCheck();
  }
});

/* -------------------------------- Init ---------------------------------- */

state.pages = [emptyPage()];
paintSmTabs();
renderRows();
renderPreview();
