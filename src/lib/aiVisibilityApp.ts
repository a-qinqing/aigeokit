/**
 * AI Visibility Checker — landing-page controller.
 *
 * L1: the form calls /api/visibility-check, which reads the public homepage,
 * robots.txt, llms.txt and sitemap.xml and scores the four signal groups.
 * No ChatGPT/Gemini/Perplexity queries happen here (that is the L2 roadmap).
 *
 * All element ids are prefixed `aiv-` to stay globally unique.
 */

import { bindGeoAuditCtaTracking, trackEvent } from './analytics';

/* ------------------------------ DOM helpers ----------------------------- */

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ------------------------------- Elements ------------------------------- */

const form = $('aiv-form') as HTMLFormElement;
const input = $('aiv-url') as HTMLInputElement;
const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
const statusEl = $('aiv-status');
const statusDomain = $('aiv-status-domain');
const errorEl = $('aiv-error');
const announcer = $('aiv-announcer');
const reportEyebrow = $('aiv-report-eyebrow');
const reportIntro = $('aiv-report-intro');
const sampleCard = $('aiv-sample-card');
const liveCard = $('aiv-live-card');
const liveBody = $('aiv-live-body');

const DEFAULT_EYEBROW = 'Sample report';
const DEFAULT_INTRO = reportIntro.textContent?.trim() ?? '';

let busy = false;

/* ------------------------------ URL parsing ----------------------------- */

/** Normalize user input into a hostname, or null when it is not a usable URL. */
function toHostname(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.') || /\s/.test(url.hostname)) return null;
    // The checker always reads the public site on its default port.
    if (url.port) return null;
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

/* --------------------------- API result types --------------------------- */

type CheckStatus = 'pass' | 'partial' | 'fail';

interface ApiCheck {
  id: string;
  label: string;
  status: CheckStatus;
  points: number;
  max: number;
  evidence: string;
  fix: string;
}

interface ApiDimension {
  id: string;
  name: string;
  score: number;
  max: number;
  checks: ApiCheck[];
}

interface ApiReport {
  total: number;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  brand: { name: string; source: string; aliases: string[] };
  dimensions: ApiDimension[];
  warnings: string[];
}

interface ApiOk {
  ok: true;
  url: string;
  final_url: string;
  fetched_at: string;
  report: ApiReport;
}

interface ApiErr {
  ok: false;
  error: string;
  message: string;
}

/* ------------------------------- Tone maps ------------------------------ */

const CHECK_TONE: Record<CheckStatus, { border: string; icon: string; iconText: string }> = {
  pass: {
    border: 'border-mint-500/20 bg-mint-500/[0.04]',
    icon: 'bg-mint-500/15 text-mint-300 ring-mint-500/30',
    iconText: '✓',
  },
  partial: {
    border: 'border-amber-500/20 bg-amber-500/[0.04]',
    icon: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
    iconText: '!',
  },
  fail: {
    border: 'border-red-500/20 bg-red-500/[0.04]',
    icon: 'bg-red-500/15 text-red-300 ring-red-500/30',
    iconText: '×',
  },
};

const GRADE_LABEL: Record<ApiReport['grade'], string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Needs work',
  poor: 'Poor',
};

const GRADE_TONE: Record<ApiReport['grade'], string> = {
  excellent: 'border-mint-500/30 bg-mint-500/10 text-mint-300',
  good: 'border-mint-500/30 bg-mint-500/10 text-mint-300',
  fair: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  poor: 'border-red-500/30 bg-red-500/10 text-red-300',
};

const BRAND_SOURCE_LABEL: Record<string, string> = {
  schema: 'from structured data',
  og: 'from og:site_name',
  title: 'from the page title',
};

/* ----------------------------- Render helpers --------------------------- */

function setState(next: 'sample' | 'loading' | 'live'): void {
  const loading = next === 'loading';
  const live = next === 'live';
  sampleCard.hidden = loading || live;
  liveCard.hidden = !loading && !live;
  reportEyebrow.textContent = loading || live ? 'Live report' : DEFAULT_EYEBROW;
  if (!loading && !live) reportIntro.textContent = DEFAULT_INTRO;
}

function setBusy(next: boolean): void {
  busy = next;
  submitButton.disabled = next;
  submitButton.textContent = next ? 'Analyzing…' : 'Analyze Visibility';
  submitButton.classList.toggle('opacity-60', next);
  submitButton.classList.toggle('cursor-wait', next);
  liveCard.setAttribute('aria-busy', String(next));
}

function showError(message: string): void {
  statusEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
  announcer.textContent = message;
}

function clearError(): void {
  errorEl.hidden = true;
  errorEl.textContent = '';
}

function renderLoading(host: string): void {
  setState('loading');
  statusDomain.textContent = host;
  statusEl.hidden = false;
  reportIntro.textContent = `Reading public signals from ${host}…`;
  announcer.textContent = `Checking ${host}…`;

  liveBody.replaceChildren();
  const wrap = el('div', 'space-y-4');
  const head = el('div', 'flex items-center gap-3');
  head.append(
    el('span', 'h-2.5 w-2.5 animate-pulse rounded-full bg-mint-400 motion-reduce:animate-none'),
    el('p', 'break-all text-sm font-semibold text-sand-200', `Analyzing ${host}`),
  );
  wrap.append(head);
  wrap.append(
    el(
      'p',
      'break-words text-[13px] leading-relaxed text-sand-400',
      'Fetching the homepage, robots.txt, llms.txt and sitemap.xml. This usually takes 2–10 seconds.',
    ),
  );

  for (const name of ['Brand Entity', 'Content Signals', 'Citation Readiness', 'AI Access']) {
    const row = el('div', 'rounded-2xl border border-ink-700 bg-ink-900/60 p-4');
    row.append(
      el('div', 'flex items-center justify-between gap-3'),
      el('div', 'mt-3 h-2 w-full animate-pulse rounded-full bg-ink-700 motion-reduce:animate-none'),
    );
    row.firstElementChild?.append(
      el('p', 'text-sm font-bold text-sand-200', name),
      el('p', 'font-mono text-[11px] text-sand-500', '—/25'),
    );
    wrap.append(row);
  }

  liveBody.append(wrap);
}

function renderCheck(item: ApiCheck): HTMLElement {
  const tone = CHECK_TONE[item.status];
  const row = el('div', `rounded-xl border px-3 py-2.5 ${tone.border}`);
  const top = el('div', 'flex items-start justify-between gap-3');
  const left = el('div', 'flex min-w-0 items-start gap-2.5');

  const icon = el(
    'span',
    `mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-md text-[10px] font-bold ring-1 ${tone.icon}`,
    tone.iconText,
  );

  const copy = el('div', 'min-w-0 break-words');
  copy.append(
    el('p', 'text-[13px] font-semibold text-sand-100', item.label),
    el('p', 'mt-0.5 break-words text-[12px] leading-relaxed text-sand-400', item.evidence),
  );
  if (item.status !== 'pass') {
    copy.append(
      el('p', 'mt-1 break-words text-[12px] leading-relaxed text-sand-500', `Fix: ${item.fix}`),
    );
  }

  left.append(icon, copy);
  top.append(left, el('span', 'shrink-0 font-mono text-[11px] font-bold text-sand-400', `${item.points}/${item.max}`));
  row.append(top);
  return row;
}

function renderDimension(dim: ApiDimension): HTMLElement {
  const block = el('div', 'mt-6');
  const head = el('div', 'flex items-baseline justify-between gap-3');
  head.append(
    el('p', 'text-sm font-bold text-sand-100', dim.name),
    el('p', 'font-mono text-xs font-bold text-sand-300', `${dim.score}/${dim.max}`),
  );

  const bar = el('div', 'mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-800 ring-1 ring-ink-700');
  const fill = el('div', 'h-full rounded-full bg-gradient-to-r from-mint-500 to-cyan-400');
  fill.style.width = `${Math.round((dim.score / dim.max) * 100)}%`;
  bar.append(fill);

  const checks = el('div', 'mt-3 space-y-2');
  for (const item of dim.checks) checks.append(renderCheck(item));

  block.append(head, bar, checks);
  return block;
}

function renderReport(data: ApiOk, host: string): void {
  const report = data.report;
  setState('live');
  statusEl.hidden = true;
  reportIntro.textContent = `Live report for ${host} — analyzed ${new Date(data.fetched_at).toLocaleString()}. This reads public signals only; it does not query ChatGPT, Gemini or Perplexity.`;

  liveBody.replaceChildren();

  const header = el('div', 'flex flex-wrap items-center justify-between gap-3');
  const reportLabel = el('p', 'inline-flex min-w-0 items-center gap-2 rounded-full border border-ink-600 bg-ink-900 px-3 py-1 text-[11px] font-semibold text-sand-400');
  reportLabel.append(el('span', 'break-all font-mono', `Live report · ${host}`));
  header.append(
    reportLabel,
    el(
      'p',
      'inline-flex items-center rounded-full border border-mint-500/30 bg-mint-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-mint-300',
      'Live data',
    ),
  );

  const scoreRow = el('div', 'mt-7 flex flex-col items-center gap-2 sm:flex-row sm:items-end sm:gap-5');
  scoreRow.append(el('p', 'text-xs font-semibold uppercase tracking-widest text-sand-500', 'AI Visibility Score'));
  const score = el('p', 'text-5xl font-extrabold tracking-tight text-sand-100 sm:text-6xl', String(report.total));
  score.append(el('span', 'text-2xl font-bold text-sand-500 sm:text-3xl', '/100'));
  scoreRow.append(score);

  const grade = el(
    'p',
    `rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${GRADE_TONE[report.grade]}`,
    GRADE_LABEL[report.grade],
  );
  scoreRow.append(grade);

  const brandLine = el(
    'p',
    'mt-2 break-words text-xs leading-relaxed text-sand-500',
    report.brand.name
      ? `Detected brand: ${report.brand.name}${BRAND_SOURCE_LABEL[report.brand.source] ? ` (${BRAND_SOURCE_LABEL[report.brand.source]})` : ''}.`
      : 'No brand entity detected in the page markup.',
  );

  const dimensions = el('div', 'mt-2');
  for (const dim of report.dimensions) dimensions.append(renderDimension(dim));

  liveBody.append(header, scoreRow, brandLine, dimensions);

  if (report.warnings.length > 0) {
    const box = el('div', 'mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-4');
    box.append(el('p', 'text-[11px] font-bold uppercase tracking-widest text-amber-300', 'Notes'));
    const list = el('ul', 'mt-2 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-sand-400');
    for (const warning of report.warnings) list.append(el('li', 'break-words', warning));
    box.append(list);
    liveBody.append(box);
  }

  const note = el(
    'p',
    'mt-7 break-words border-t border-ink-700/70 pt-5 text-[12px] leading-relaxed text-sand-500',
    'L1 methodology: this score is built from the homepage HTML, robots.txt, llms.txt and sitemap.xml. It describes AI readiness and crawler access — it is not a measurement of placement in any AI answer.',
  );
  const cta = el(
    'a',
    'mt-4 inline-flex text-xs font-bold text-mint-400 transition-colors hover:text-mint-300',
    'Want the page-by-page version? Request a GEO audit →',
  );
  cta.href = '/geo-audit/';
  cta.dataset.track = 'request-geo-audit';
  cta.dataset.trackLabel = 'visibility report CTA';
  // The report is rendered after the page-load CTA binding, so wire this one
  // directly instead of re-running the global binder (which would double-bind).
  cta.addEventListener('click', () => {
    trackEvent('request_geo_audit_click', {
      page: window.location.pathname,
      label: 'visibility report CTA',
    });
  });
  liveBody.append(note, cta);

  announcer.textContent = `Report ready. AI visibility score ${report.total} out of 100.`;
  liveCard.classList.add('aiv-reveal');
  window.setTimeout(() => liveCard.classList.remove('aiv-reveal'), 1800);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  liveCard.focus({ preventScroll: true });
  liveCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

/* -------------------------------- Check --------------------------------- */

async function runCheck(host: string): Promise<void> {
  setBusy(true);
  clearError();
  renderLoading(host);

  trackEvent('visibility_check_start', { page: '/ai-visibility-checker/' });

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(`/api/visibility-check?url=${encodeURIComponent(host)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    let data: ApiOk | ApiErr;
    try {
      data = (await response.json()) as ApiOk | ApiErr;
    } catch {
      throw new Error('invalid-json');
    }

    if (!data.ok) {
      setState('sample');
      showError(data.message);
      trackEvent('visibility_check_error', { error: data.error });
      return;
    }

    renderReport(data, host);
    trackEvent('visibility_check_success', {
      score: data.report.total,
      grade: data.report.grade,
    });
  } catch (err) {
    setState('sample');
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    showError(
      aborted
        ? 'The check timed out. The site may be slow or blocking automated requests — try again in a moment.'
        : 'The checker could not be reached. Please try again in a moment.',
    );
    trackEvent('visibility_check_error', {
      error: aborted ? 'client-timeout' : 'network',
    });
  } finally {
    window.clearTimeout(timer);
    setBusy(false);
  }
}

/* -------------------------------- Submit -------------------------------- */

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;

  const host = toHostname(input.value);
  trackEvent('analyze_visibility_click', {
    page: '/ai-visibility-checker/',
    valid_url: Boolean(host),
  });

  if (!host) {
    showError('Enter a website URL such as https://example.com — or just example.com.');
    statusEl.hidden = true;
    input.focus();
    return;
  }

  void runCheck(host);
});

/* ------------------------- Conversion tracking -------------------------- */

bindGeoAuditCtaTracking();
