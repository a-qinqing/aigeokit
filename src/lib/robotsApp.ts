/**
 * AI Robots.txt & Crawler Checker — page controller.
 *
 * Owns the form state machine (URL-mode → /api/check-robots edge function,
 * paste-mode → fully local parse) and renders the spec-v3 results UI:
 * AI Crawlability Score dashboard, per-category bot status cards, a raw
 * robots.txt preview and an interactive snippet generator with quick
 * policy toggles (allow AI search citation / block training crawlers / ...).
 *
 * All element ids are prefixed `robots-` — the schema generator's app.ts is
 * never loaded on this page, but ids stay globally unique anyway.
 */

import { analyzeRobotsTxt, CATEGORY_LABELS } from './robots';
import type { BotStatus, BotStatusRow } from './robots';

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

/* ------------------------------ Status tones ----------------------------- */
// Spec v3 badge scheme: green Allowed, red Blocked, gray Default.

const STATUS_BADGE: Record<BotStatus, string> = {
  allowed: 'bg-mint-500/15 text-mint-300 border-mint-500/30',
  disallowed: 'bg-red-500/15 text-red-300 border-red-500/30',
  default_allowed:
    'border-sand-500/40 bg-sand-500/10 text-sand-300',
};

const STATUS_LABEL: Record<BotStatus, string> = {
  allowed: 'Allowed',
  disallowed: 'Blocked',
  default_allowed: 'Default',
};

/**
 * Score band driven by both the number AND the composition of statuses —
 * a purely "Default" report (e.g. empty robots.txt, score 50) must never be
 * branded as "Heavily blocked".
 */
function scoreInfo(
  score: number,
  counts: Record<BotStatus, number>,
): { label: string; tone: 'good' | 'partial' | 'blocked' } {
  if (counts.disallowed > 0) {
    if (score >= 60) return { label: 'Partially blocked', tone: 'partial' };
    return { label: 'Heavily blocked', tone: 'blocked' };
  }
  if (counts.default_allowed > 0) {
    return { label: 'Allowed by default — make explicit', tone: 'partial' };
  }
  return { label: 'AI-ready', tone: 'good' };
}

const TONE_CHIP: Record<'good' | 'partial' | 'blocked', string> = {
  good: 'bg-mint-500/15 text-mint-300 border-mint-500/30',
  partial: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  blocked: 'bg-red-500/15 text-red-300 border-red-500/30',
};

/* ------------------------------- Elements ------------------------------- */

const form = $('robots-form') as HTMLFormElement;
const urlBlock = $('robots-url-block');
const urlInput = $('robots-url') as HTMLInputElement;
const pasteWrap = $('robots-paste-wrap');
const pasteInput = $('robots-paste') as HTMLTextAreaElement;
const modeToggle = $('robots-mode-toggle') as HTMLButtonElement;
const statusBox = $('robots-status');
const resultsBox = $('robots-results');

const TOGGLE_URL_LABEL = '📋 Paste robots.txt instead';
const TOGGLE_PASTE_LABEL = '🌐 Check a live URL instead';

let mode: 'url' | 'paste' = 'url';
let busy = false;

/* --------------------------- Report state ------------------------------- */

interface Policy {
  allowSearch: boolean;
  blockTraining: boolean;
  allowUser: boolean;
}

let lastRows: BotStatusRow[] = [];
let lastRaw = '';
let lastScore = 0;
let policy: Policy = { allowSearch: false, blockTraining: false, allowUser: false };

/* ------------------------------ Status UI ------------------------------- */

function renderLoading(label: string): void {
  resultsBox.classList.add('hidden');
  statusBox.innerHTML = `
    <p class="flex items-center gap-2 text-sm text-sand-400">
      <span class="h-2 w-2 animate-pulse rounded-full bg-mint-400"></span>
      ${esc(label)}
    </p>`;
}

interface ErrorOptions {
  /** Show an inline paste-textarea so users can analyze locally right away
   *  (fetch failures, timeouts, missing robots.txt, ...). */
  fallback?: boolean;
  /** Show the "switch to paste mode" shortcut button. */
  hintPaste?: boolean;
}

function renderError(title: string, detail: string, opts: ErrorOptions = {}): void {
  const { fallback = false, hintPaste = true } = opts;
  resultsBox.classList.add('hidden');
  statusBox.innerHTML = `
    <div role="alert" class="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
      <p class="text-sm font-bold text-red-300">${esc(title)}</p>
      <p class="mt-1 text-[13px] leading-relaxed text-red-200/80">${esc(detail)}</p>
      ${
        !fallback && hintPaste
          ? `<button type="button" id="robots-error-paste" class="mt-3 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-semibold text-sand-300 transition-colors hover:border-mint-500/40">
               📋 Switch to paste mode
             </button>`
          : ''
      }
    </div>
    ${
      fallback
        ? `
    <div class="mt-3 rounded-xl border border-ink-700 bg-ink-850 p-4">
      <label for="robots-fallback-paste" class="text-xs font-bold text-sand-100">
        📋 Paste your robots.txt to analyze it locally instead
      </label>
      <textarea id="robots-fallback-paste" rows="8" spellcheck="false"
        placeholder="User-agent: *&#10;Allow: /&#10;&#10;User-agent: GPTBot&#10;Disallow: /"
        class="mt-2 w-full resize-y rounded-xl border border-ink-600 bg-ink-900 px-3 py-2 font-mono text-xs leading-relaxed text-sand-100 placeholder:text-sand-500 focus:border-mint-500 focus:outline-none"></textarea>
      <p class="mt-1.5 text-[11px] text-sand-500">Parsed 100% in your browser — nothing is sent anywhere.</p>
      <button type="button" id="robots-fallback-run"
              class="mt-2 rounded-lg bg-mint-500 px-4 py-2 text-xs font-bold text-ink-950 transition-colors hover:bg-mint-400">
        Analyze pasted text
      </button>
    </div>`
        : ''
    }`;
  const hint = document.getElementById('robots-error-paste');
  hint?.addEventListener('click', () => setMode('paste'));
  const run = document.getElementById('robots-fallback-run');
  run?.addEventListener('click', () => {
    const ta = document.getElementById('robots-fallback-paste') as HTMLTextAreaElement | null;
    if (!ta) return;
    if (!ta.value.trim()) {
      renderError('Paste your robots.txt first', 'Copy the contents of your robots.txt file into the box above.', {
        fallback: true,
        hintPaste: false,
      });
      return;
    }
    const analysis = analyzeRobotsTxt(ta.value);
    renderReport(
      analysis,
      { label: 'Pasted robots.txt', note: 'Analyzed 100% in your browser — nothing was sent over the network.' },
      ta.value,
    );
  });
}

/* ------------------------------- Modes ---------------------------------- */

function setMode(next: 'url' | 'paste'): void {
  mode = next;
  urlBlock.classList.toggle('hidden', next === 'paste');
  pasteWrap.classList.toggle('hidden', next !== 'paste');
  modeToggle.textContent = next === 'paste' ? TOGGLE_PASTE_LABEL : TOGGLE_URL_LABEL;
  (next === 'paste' ? pasteInput : urlInput).focus();
  // New mode → drop stale output.
  statusBox.innerHTML = '';
  resultsBox.classList.add('hidden');
}

/* ------------------------------ API (URL mode) -------------------------- */

/** Success payload of /api/check-robots (spec robots功能2.txt). */
interface ApiOk {
  ok: true;
  url: string;
  final_url: string;
  http_status: number;
  size_bytes: number;
  truncated: boolean;
  raw_robots_txt: string;
  score: number;
  bots_status: BotStatusRow[];
  summary: string[];
}

interface ApiErr {
  ok: false;
  error: string;
  message: string;
}

async function checkUrl(rawUrl: string): Promise<void> {
  renderLoading(`Fetching robots.txt from ${rawUrl}…`);
  let payload: ApiOk | ApiErr;
  try {
    const res = await fetch(`/api/check-robots?url=${encodeURIComponent(rawUrl)}`);
    try {
      payload = (await res.json()) as ApiOk | ApiErr;
    } catch {
      throw new Error('bad-response');
    }
  } catch {
    renderError(
      'Checker service unavailable',
      'The /api/check-robots edge function could not be reached. Paste the file below to analyze it locally — it never leaves your browser.',
      { fallback: true, hintPaste: false },
    );
    return;
  }

  if (!payload.ok) {
    const titles: Record<string, string> = {
      'invalid-url': 'That does not look like a public domain',
      'no-robots': 'No robots.txt found',
      'not-robots-txt': 'That URL returned an HTML page',
      timeout: 'The site did not respond in time',
      unreachable: 'Could not reach that site',
    };
    // Fetch-grade failures auto-reveal the local paste fallback.
    const autoFallback = ['timeout', 'unreachable', 'no-robots', 'not-robots-txt'].includes(
      payload.error,
    );
    renderError(
      titles[payload.error] ?? 'Could not check that domain',
      payload.message +
        (payload.error === 'no-robots' || payload.error === 'unreachable'
          ? ' The site may be offline, blocking automated fetches, or genuinely have no robots.txt.'
          : ''),
      autoFallback ? { fallback: true, hintPaste: false } : { hintPaste: false },
    );
    return;
  }

  const meta = {
    label: payload.url,
    note: `HTTP ${payload.http_status} · ${payload.size_bytes.toLocaleString()} B${
      payload.truncated ? ' · truncated' : ''
    }`,
  };
  renderReport(
    { score: payload.score, bots_status: payload.bots_status, summary: payload.summary },
    meta,
    payload.raw_robots_txt,
  );
}

/* -------------------------- Local parse (paste) ------------------------- */

async function checkPaste(text: string): Promise<void> {
  renderLoading('Parsing pasted robots.txt…');
  // Keep the microtask so the loading label paints before heavy rendering.
  await new Promise((r) => setTimeout(r, 30));
  const analysis = analyzeRobotsTxt(text);
  renderReport(analysis, {
    label: 'Pasted robots.txt',
    note: 'Analyzed 100% in your browser — nothing was sent over the network.',
  }, text);
}

/* ----------------------------- Results UI ------------------------------- */

interface ReportMeta {
  label: string;
  note: string;
}

type Report = Pick<ApiOk, 'score' | 'bots_status' | 'summary'>;

function renderReport(report: Report, meta: ReportMeta, raw: string): void {
  lastRows = report.bots_status;
  lastRaw = raw;
  lastScore = report.score;
  // Toggles default to what actually changes something in this file.
  policy = {
    allowSearch: lastRows.some(
      (r) => r.category === 'ai-search' && r.status !== 'allowed',
    ),
    blockTraining: lastRows.some(
      (r) => r.category === 'training' && r.status !== 'disallowed',
    ),
    allowUser: lastRows.some(
      (r) => r.category === 'user-triggered' && r.status !== 'allowed',
    ),
  };

  statusBox.innerHTML = '';
  resultsBox.classList.remove('hidden');
  const sourceLabel = meta.label === 'Pasted robots.txt' ? 'pasted content' : 'fetched file';
  resultsBox.innerHTML = `
    ${scoreCardHtml(report, meta)}
    ${scoreDiagnosisHtml(report.bots_status)}
    ${summaryHtml(report.summary)}
    ${categoryCardsHtml(report.bots_status)}
    ${snippetCardHtml()}
    ${rawPreviewHtml(raw, sourceLabel)}`;
  // The snippet <pre> starts empty in the template — fill it with the
  // default-policy snippet right away (also syncs toggle visuals).
  refreshSnippetArea();
}

function scoreCardHtml(report: Report, meta: ReportMeta): string {
  const { score } = report;
  const counts = report.bots_status.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      return acc;
    },
    { allowed: 0, disallowed: 0, default_allowed: 0 } as Record<BotStatus, number>,
  );
  const band = scoreInfo(score, counts);

  return `
    <!-- Dashboard: AI Crawlability Score -->
    <div class="flex flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-850 p-5 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex items-center gap-4">
        <span class="text-5xl font-extrabold tracking-tight text-sand-100">${score}</span>
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 text-base font-extrabold tracking-tight text-sand-100">
            <span class="${TONE_CHIP[band.tone]} inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">${esc(band.label)}</span>
            AI Crawlability Score
          </p>
          <p class="mt-1 text-xs leading-relaxed text-sand-500">
            GEO-weighted crawlability of the 9 monitored crawlers — citation/search crawlers
            weigh more than training crawlers.
          </p>
        </div>
      </div>
      <div class="min-w-0 lg:text-right">
        <p class="break-all text-xs font-semibold text-sand-300">${esc(meta.label)}</p>
        <p class="mt-0.5 text-[11px] text-sand-500">${esc(meta.note)}</p>
        <div class="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold lg:justify-end">
          <span class="rounded-full border border-mint-500/30 bg-mint-500/15 px-2.5 py-1 text-mint-300">${counts.allowed} Allowed</span>
          <span class="rounded-full border border-sand-500/40 bg-sand-500/10 px-2.5 py-1 text-sand-300">${counts.default_allowed} Default</span>
          <span class="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">${counts.disallowed} Blocked</span>
        </div>
      </div>
    </div>`;
}

/* --------------------- Score attribution diagnosis ---------------------- */
// Points behind a fully blocked crawler per category (out of 100, weights
// 3/2/1 over 17 → 18 / 12 / 6). Implicit ("Default") access keeps half.
const PTS_BLOCKED: Record<BotStatusRow['category'], number> = {
  'ai-search': 18,
  training: 6,
  'user-triggered': 12,
};
const PRODUCT_OF: Record<string, string> = {
  'oai-searchbot': 'SearchGPT & ChatGPT search',
  perplexitybot: 'Perplexity answers',
  bingbot: 'Bing AI / Copilot',
  'chatgpt-user': 'live ChatGPT browsing',
  'claude-web': 'live Claude browsing',
  gptbot: 'OpenAI training',
  claudebot: 'Claude training',
  'google-extended': 'Google AI features',
  ccbot: 'LLM training sets',
};

/** One dynamic sentence attributing the biggest score deductions. */
function scoreDiagnosisHtml(rows: BotStatusRow[]): string {
  const names = (r: BotStatusRow[]) =>
    r.map((x) => `<strong class="text-sand-100">${esc(x.name)}</strong>`).join(', ');
  const products = (r: BotStatusRow[]) =>
    [...new Set(r.map((x) => PRODUCT_OF[x.ua_token] ?? x.name))].join(' & ');

  const blockedSearch = rows.filter((r) => r.category === 'ai-search' && r.status === 'disallowed');
  const defaultSearch = rows.filter((r) => r.category === 'ai-search' && r.status === 'default_allowed');
  const blockedUser = rows.filter((r) => r.category === 'user-triggered' && r.status === 'disallowed');
  const blockedTraining = rows.filter((r) => r.category === 'training' && r.status === 'disallowed');
  const defaultTraining = rows.filter((r) => r.category === 'training' && r.status === 'default_allowed');
  const defaultUser = rows.filter((r) => r.category === 'user-triggered' && r.status === 'default_allowed');

  let msg: string;
  if (blockedSearch.length > 0) {
    msg = `You block ${names(blockedSearch)} (−${PTS_BLOCKED['ai-search']} pts each) — ${products(blockedSearch)} can no longer cite your pages. This is the heaviest drag on your score.`;
  } else if (defaultSearch.length > 0) {
    msg = `${names(defaultSearch)} are only implicitly allowed (−${PTS_BLOCKED['ai-search'] / 2} pts each) — an explicit Allow: / rule keeps you citable in ${products(defaultSearch)}.`;
  } else if (blockedUser.length > 0) {
    msg = `You block ${names(blockedUser)} (−${PTS_BLOCKED['user-triggered']} pts each) — ${products(blockedUser)} cannot reach your pages on demand.`;
  } else if (blockedTraining.length > 0) {
    msg = `Training crawlers ${names(blockedTraining)} are blocked (−${PTS_BLOCKED['training']} pts each) — a deliberate opt-out; citation crawlers are unaffected.`;
  } else if (defaultTraining.length > 0 || defaultUser.length > 0) {
    const rest = [...defaultTraining, ...defaultUser];
    msg = `${names(rest)} inherit your wildcard rules (${esc(rest[0].rule_line)}) — add explicit rules to lock in your current stance.`;
  } else {
    msg = 'No deductions — every monitored crawler is explicitly allowed.';
  }

  return `
    <p class="mt-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-2.5 text-xs leading-relaxed text-sand-400">
      💡 <span class="font-semibold text-sand-100">Diagnosis:</span> ${msg}
    </p>`;
}

function summaryHtml(summary: string[]): string {
  if (summary.length === 0) return '';
  return `
    <div class="mt-4 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
      <p class="text-[11px] font-semibold uppercase tracking-widest text-sand-500">GEO impact</p>
      <ul class="mt-2 space-y-1.5">
        ${summary
          .map(
            (s) =>
              `<li class="flex gap-2 text-[13px] leading-relaxed text-sand-300">
                 <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mint-400"></span>
                 <span>${esc(s)}</span>
               </li>`,
          )
          .join('')}
      </ul>
    </div>`;
}

/** One card per crawler class: header row + status rows for its bots. */
function categoryCardsHtml(rows: BotStatusRow[]): string {
  let out = '';
  let lastCategory = '';
  for (const row of rows) {
    if (row.category !== lastCategory) {
      lastCategory = row.category;
      const members = rows.filter((r) => r.category === lastCategory);
      const membersHtml = members.map(rowHtml).join('');
      out += `
        <div class="mt-5 overflow-hidden rounded-2xl border border-ink-700 bg-ink-850">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-700 px-5 py-3.5">
            <p class="text-sm font-bold text-sand-100">${CATEGORY_LABELS[row.category]}</p>
            <p class="text-[11px] text-sand-500">${members.length} crawler${members.length === 1 ? '' : 's'}</p>
          </div>
          <ul class="divide-y divide-ink-700/70">${membersHtml}</ul>
        </div>`;
    }
  }
  return out;
}

function rowHtml(row: BotStatusRow): string {
  const sourceChip =
    row.source === 'wildcard'
      ? '<span class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">via User-agent: *</span>'
      : row.source === 'explicit'
        ? '<span class="rounded-full border border-ink-600 bg-ink-800 px-2 py-0.5 text-[10px] font-semibold text-sand-400">explicit rule</span>'
        : '';

  const actions =
    row.status === 'allowed'
      ? ''
      : `<div class="mt-2.5 flex justify-end">
           <button type="button" data-action="copy-bot" data-token="${esc(row.ua_token)}"
                   class="rounded-lg border border-ink-600 px-3 py-1.5 text-[11px] font-semibold text-sand-300 transition-colors hover:border-mint-500/40 hover:text-mint-300">
             Copy allow rule
           </button>
         </div>`;

  return `
    <li class="px-5 py-4">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span class="text-sm font-bold text-sand-100">${esc(row.name)}</span>
        <span class="text-xs text-sand-500">${esc(row.vendor)}</span>
        <code class="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-mint-300">${esc(row.ua_token)}</code>
        <span class="ml-auto flex flex-wrap items-center gap-1.5">
          ${sourceChip}
          <span class="${STATUS_BADGE[row.status]} inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">
            ${STATUS_LABEL[row.status]}
          </span>
        </span>
      </div>
      <p class="mt-1.5 text-xs leading-relaxed text-sand-400">
        ${row.status === 'allowed' ? 'This crawler can read your site.' : esc(row.impact)}
      </p>
      ${
        row.rule_line
          ? `<p class="mt-1.5 font-mono text-[11px] leading-relaxed text-sand-500">${esc(row.rule_line)}${
              row.restrictions
                ? ` &nbsp;·&nbsp; Restricts ${esc(row.restrictions)}`
                : ''
            }</p>`
          : ''
      }
      ${actions}
    </li>`;
}

/* --------------------- Snippet generator (policy toggles) --------------- */

const POLICY_DEFS: { key: keyof Policy; label: string; hint: string }[] = [
  {
    key: 'allowSearch',
    label: 'Allow all AI Search & Citation crawlers',
    hint: 'OAI-SearchBot · PerplexityBot · Bingbot',
  },
  {
    key: 'blockTraining',
    label: 'Block all Model Training crawlers',
    hint: 'GPTBot · ClaudeBot · Google-Extended · CCBot',
  },
  {
    key: 'allowUser',
    label: 'Allow User-Triggered browsing',
    hint: 'ChatGPT-User · Claude-Web',
  },
];

/**
 * Rules are additive: allow sections only emit bots that are NOT already
 * explicitly allowed, block sections only bots that are NOT already blocked —
 * so the generated block never duplicates rules the user already has.
 */
function ruleLinesFor(rows: BotStatusRow[], cat: BotStatusRow['category'], allow: boolean): string {
  return rows
    .filter(
      (r) => r.category === cat && (allow ? r.status !== 'allowed' : r.status !== 'disallowed'),
    )
    .map((r) => `User-agent: ${r.ua_token}\n${allow ? 'Allow' : 'Disallow'}: /`)
    .join('\n\n');
}

function currentSnippet(): string {
  const sections: string[] = [];
  if (policy.allowSearch)
    sections.push(
      `# Allow AI search & citation crawlers (SearchGPT, Perplexity, Bing AI)\n${ruleLinesFor(lastRows, 'ai-search', true)}`,
    );
  if (policy.blockTraining)
    sections.push(
      `# Block AI model training crawlers\n${ruleLinesFor(lastRows, 'training', false)}`,
    );
  if (policy.allowUser)
    sections.push(
      `# Allow user-triggered browsing (ChatGPT & Claude apps)\n${ruleLinesFor(lastRows, 'user-triggered', true)}`,
    );
  if (sections.length === 0)
    return '# No sections selected — toggle a policy above to generate robots.txt rules.';

  return [
    '# AIGEOKit Robots.txt Snippet — paste below your existing rules, then re-check.',
    '# Review overlaps with rules you already have before deploying.',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

function snippetCardHtml(): string {
  const toggles = POLICY_DEFS.map(
    (def) => `
      <button type="button" data-action="toggle" data-policy="${def.key}"
              role="switch" aria-checked="${policy[def.key]}"
              class="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                policy[def.key]
                  ? 'border-mint-500/50 bg-mint-500/10 text-mint-300'
                  : 'border-ink-600 bg-ink-900/40 text-sand-400 hover:border-ink-500'
              }">
        <span class="mt-0.5 flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          policy[def.key] ? 'justify-end bg-mint-500' : 'justify-start bg-ink-600'
        }">
          <span class="h-4 w-4 rounded-full bg-ink-950"></span>
        </span>
        <span class="min-w-0">
          <span class="block text-xs font-bold">${esc(def.label)}</span>
          <span class="block font-mono text-[10px] opacity-70">${esc(def.hint)}</span>
        </span>
      </button>`,
  ).join('');

  return `
    <!-- Robots.txt Snippet Generator -->
    <div class="mt-5 rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <p class="text-sm font-bold text-sand-100">Robots.txt Snippet Generator</p>
      <p class="mt-1 text-xs leading-relaxed text-sand-500">
        Pick a policy — the block below updates instantly. Toggles start at what your current
        robots.txt is missing; flip them to build the exact rules you want.
      </p>
      <div class="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        ${toggles}
      </div>
      <pre id="robots-snippet-pre" class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-ink-700 bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-sand-300"></pre>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-[11px] text-sand-500">Copy-paste into your robots.txt file at <code class="text-sand-400">/robots.txt</code>.</p>
        <button type="button" data-action="copy-snippet"
                class="rounded-lg bg-mint-500 px-4 py-2 text-xs font-bold text-ink-950 transition-colors hover:bg-mint-400">
          Copy to Clipboard
        </button>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-3.5 py-2.5">
        <p class="text-[11px] leading-relaxed text-sand-400">
          💡 Using WordPress? Manage and deploy these custom rules safely with WPCode.
        </p>
        <a href="https://library.wpcode.com/?ref=207" target="_blank" rel="nofollow sponsored"
           class="shrink-0 rounded-lg bg-mint-500 px-3 py-1.5 text-[11px] font-bold text-ink-950 transition-colors hover:bg-mint-400">
          Get WPCode →
        </a>
      </div>
    </div>`;
}

function refreshSnippetArea(): void {
  const pre = document.getElementById('robots-snippet-pre');
  if (!pre) return;
  pre.textContent = currentSnippet();
  document.querySelectorAll('[data-action="toggle"]').forEach((el) => {
    const b = el as HTMLElement;
    const on = policy[b.dataset.policy as keyof Policy];
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('border-mint-500/50', on);
    b.classList.toggle('bg-mint-500/10', on);
    b.classList.toggle('text-mint-300', on);
    b.classList.toggle('border-ink-600', !on);
    b.classList.toggle('bg-ink-900/40', !on);
    b.classList.toggle('text-sand-400', !on);
    b.querySelector('span.flex')?.classList.toggle('justify-end', on);
    b.querySelector('span.flex')?.classList.toggle('justify-start', !on);
    b.querySelector('span.flex')?.classList.toggle('bg-mint-500', on);
    b.querySelector('span.flex')?.classList.toggle('bg-ink-600', !on);
  });
}

/** Raw robots.txt source preview (code block). */
function rawPreviewHtml(raw: string, sourceLabel: string): string {
  const size = `${raw.length.toLocaleString()} chars`;
  const clipNote =
    raw.length > 8000 ? ' · preview shows the first 8,000 characters' : '';
  return `
    <div class="mt-5 rounded-2xl border border-ink-700 bg-ink-850 p-5">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm font-bold text-sand-100">Robots.txt source</p>
        <p class="text-[11px] text-sand-500">${sourceLabel} · ${size}${clipNote}</p>
      </div>
      <pre class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-ink-700 bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-sand-400">${esc(
        raw.slice(0, 8000),
      )}</pre>
    </div>`;
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

/* -------------------------------- Wiring -------------------------------- */

function wireResults(): void {
  resultsBox.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest('button[data-action]');
    if (!target) return;
    const btn = target as HTMLButtonElement;
    const action = btn.dataset.action;

    if (action === 'copy-bot' && btn.dataset.token) {
      const ok = await copyText(`User-agent: ${btn.dataset.token}\nAllow: /`);
      if (ok) flashCopied(btn);
    } else if (action === 'copy-snippet') {
      const ok = await copyText(currentSnippet());
      if (ok) flashCopied(btn);
    } else if (action === 'toggle' && btn.dataset.policy) {
      const key = btn.dataset.policy as keyof Policy;
      policy = { ...policy, [key]: !policy[key] };
      refreshSnippetArea();
    }
  });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (busy) return;

  if (mode === 'url') {
    const value = urlInput.value.trim();
    if (!value) {
      renderError('Enter a domain first', 'For example: example.com — or https://example.com.', {
        hintPaste: false,
      });
      return;
    }
    busy = true;
    void checkUrl(value).finally(() => {
      busy = false;
    });
  } else {
    const text = pasteInput.value;
    if (!text.trim()) {
      renderError('Paste your robots.txt first', 'Copy the contents of your robots.txt file into the box above.', {
        hintPaste: false,
      });
      return;
    }
    busy = true;
    void checkPaste(text).finally(() => {
      busy = false;
    });
  }
});

// Quick Try preset tags: fill the URL input and analyze immediately.
urlBlock.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('button[data-quicktry]') as HTMLButtonElement | null;
  if (!target?.dataset.quicktry) return;
  urlInput.value = target.dataset.quicktry;
  if (!busy) form.requestSubmit();
});

modeToggle.addEventListener('click', () => setMode(mode === 'url' ? 'paste' : 'url'));

wireResults();
