/**
 * llms.txt Builder & Validator — pure logic, no DOM.
 *
 * Implements the llmstxt.org file convention (https://llmstxt.org/):
 *
 *     # Site Name                       ← H1, first line
 *     > A short summary                  ← blockquote summary
 *
 *     (optional details / H2 sections)
 *
 *     - [Page Title](https://…): description
 *     - [Another Page](https://…)
 *     [llms-full.txt](https://…/llms-full.txt)   ← optional
 *
 * Everything here is side-effect free so the builder UI (llmsApp.ts),
 * the validator view and the sitemap importer all share one engine.
 */

export interface LlmsPage {
  url: string;
  title: string;
  description: string;
}

export interface LlmsState {
  /** Becomes the `# Title` line. */
  siteName: string;
  /** Becomes the `> Summary` blockquote line. */
  summary: string;
  pages: LlmsPage[];
  /** Optional extra Markdown (H2 sections, guidance) after the summary. */
  details?: string;
  /** Optional /llms-full.txt link. */
  llmsFullUrl?: string;
  /** Append the attribution comment at the bottom of the generated file.
   *  Defaults to on unless explicitly set to false. */
  credit?: boolean;
}

/** Attribution comment appended to generated files (opt-out via `credit: false`). */
export const CREDIT_COMMENT =
  '<!-- Generated with AIGEOKit (https://www.aigeokit.com/tools/llm-txt-builder/) -->';

export type IssueSeverity = 'error' | 'warn' | 'suggestion';

export interface LlmsIssue {
  severity: IssueSeverity;
  /** 1-based line number; null = whole-file issue. */
  line: number | null;
  message: string;
  /** Concrete fix / suggestion text shown in the validator UI. */
  fix?: string;
}

/* ------------------------------ Builder ------------------------------ */

/** One line per page in strict `- [Title](URL): Description` form. */
function pageLine(page: LlmsPage): string {
  // Sanitize so every page stays a single clean line.
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  const url = clean(page.url);
  const title = clean(page.title) || url; // never emit an empty link label
  const label = title.replace(/[\[\]]/g, (c) => `\\${c}`);
  const desc = clean(page.description);
  return desc ? `- [${label}](${url}): ${desc}` : `- [${label}](${url})`;
}

/**
 * Render the state to a standard llms.txt document.
 * Trailing content is ordered: title → summary → optional details → links
 * → optional llms-full.txt link (per the llmstxt.org reference layout).
 */
export function buildLlmsTxt(state: LlmsState): string {
  const parts: string[] = [`# ${state.siteName.trim()}`, `> ${state.summary.trim()}`];

  const details = (state.details ?? '').trim();
  if (details) parts.push(details);

  const pages = state.pages.filter((p) => p.url.trim());
  if (pages.length > 0) parts.push(pages.map(pageLine).join('\n'));

  const full = (state.llmsFullUrl ?? '').trim();
  if (full) parts.push(`[llms-full.txt](${full})`);

  let out = parts.join('\n\n') + '\n';
  if (state.credit !== false) out += '\n' + CREDIT_COMMENT + '\n';
  return out;
}

/** Issues that block or weaken a *generated* file (drives the live preview). */
export function stateIssues(state: LlmsState): LlmsIssue[] {
  const issues: LlmsIssue[] = [];
  if (!state.siteName.trim()) {
    issues.push({
      severity: 'error',
      line: null,
      message: 'Site name is missing',
      fix: 'Add your site name — it becomes the # title line of llms.txt.',
    });
  }
  if (!state.summary.trim()) {
    issues.push({
      severity: 'warn',
      line: null,
      message: 'No blockquote summary yet',
      fix: 'Write 1–2 sentences on what the site contains; LLMs read this before any link.',
    });
  }
  const urls = state.pages.map((p) => p.url.trim()).filter(Boolean);
  if (urls.length === 0) {
    issues.push({
      severity: 'warn',
      line: null,
      message: 'No pages listed',
      fix: 'Add links manually below, or import a sitemap to pull in your URLs automatically.',
    });
  } else {
    const seen = new Set<string>();
    for (const u of urls) {
      if (seen.has(u)) {
        issues.push({
          severity: 'warn',
          line: null,
          message: `Duplicate page URL: ${u}`,
          fix: 'Each URL should appear once — remove the duplicate row.',
        });
        break; // one warning is enough for the preview banner
      }
      seen.add(u);
    }
  }
  const full = (state.llmsFullUrl ?? '').trim();
  if (full && !/^https?:\/\//i.test(full)) {
    issues.push({
      severity: 'warn',
      line: null,
      message: 'llms-full.txt link does not look like a URL',
      fix: 'Paste the absolute URL, e.g. https://example.com/llms-full.txt',
    });
  }
  if (urls.length > 20 && !full) {
    issues.push({
      severity: 'suggestion',
      line: null,
      message: 'More than 20 links — consider an llms-full.txt',
      fix: 'Add the optional [llms-full.txt](…) link so the short file stays scannable.',
    });
  }
  return issues;
}

/* ---------------------------- Sitemap import -------------------------- */

export type ParsedSitemap =
  | { ok: true; kind: 'urlset' | 'sitemapindex'; locs: string[] }
  | { ok: false; error: 'parse' | 'empty' };

const MAX_SITEMAP_LOCS = 20_000;

/**
 * Parse sitemap XML (a <urlset> of pages or a <sitemapindex> whose locs are
 * child sitemaps) into a de-duplicated, ordered list of http(s) URLs.
 * Uses DOMParser — browser only, which is fine: this module runs client-side.
 */
export function parseSitemapXml(xml: string): ParsedSitemap {
  if (typeof DOMParser === 'undefined') return { ok: false, error: 'parse' };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return { ok: false, error: 'parse' };
  }
  if (doc.querySelector('parsererror')) return { ok: false, error: 'parse' };

  const rootTag = (doc.documentElement?.tagName ?? '').toLowerCase();
  if (!rootTag.includes('urlset') && !rootTag.includes('sitemapindex')) {
    return { ok: false, error: 'parse' };
  }

  // getElementsByTagNameNS('*', …) matches <loc> under any namespace.
  const locs: string[] = [];
  const seen = new Set<string>();
  const nodes = doc.getElementsByTagNameNS('*', 'loc');
  for (let i = 0; i < nodes.length && locs.length < MAX_SITEMAP_LOCS; i++) {
    const loc = (nodes[i].textContent ?? '').trim();
    if (!/^https?:\/\//i.test(loc)) continue; // ignore mailto:, protocol-relative, …
    if (seen.has(loc)) continue;
    seen.add(loc);
    locs.push(loc);
  }

  if (locs.length === 0) return { ok: false, error: 'empty' };
  return { ok: true, kind: rootTag.includes('sitemapindex') ? 'sitemapindex' : 'urlset', locs };
}

/** Derive a readable page title from a URL path (fallback: hostname). */
export function urlToTitle(url: string): string {
  const pretty = (raw: string) =>
    raw
      .replace(/[-_+.]+/g, ' ')
      .replace(/\.(html?|php|aspx?)$/i, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => (w.length <= 2 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
      .join(' ');

  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      const t = pretty(decodeURIComponent(segs[i]));
      if (t) return t;
    }
    return pretty(u.hostname.replace(/^www\./, ''));
  } catch {
    const host = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    return pretty(host || url);
  }
}

/* ------------------------------ Validator ----------------------------- */

const LINK_RE = /^-\s+\[([^\]]*)\]\(([^)\s]+)\)(?:\s*:\s*(.*))?$/;
const H1_RE = /^#\s+\S/;
const H2_RE = /^##\s+/;
const SUMMARY_RE = /^>\s?/;

/**
 * Validate an existing llms.txt document against the standard structure:
 * H1 title, blockquote summary and optional H2 sections, plus per-line link
 * hygiene (format, duplicates, http vs https, llms-full.txt hint).
 */
export function validateLlmsTxt(text: string): LlmsIssue[] {
  const issues: LlmsIssue[] = [];
  if (!text.trim()) {
    issues.push({
      severity: 'error',
      line: null,
      message: 'File is empty',
      fix: 'Paste the contents of your /llms.txt file, or generate one above.',
    });
    return issues;
  }

  const lines = text.split(/\r?\n/);
  const nonEmpty = (i: number) => i >= 0 && i < lines.length && lines[i].trim() !== '';
  const first = lines.findIndex((l) => l.trim() !== '');
  const last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim() !== '');

  /* ---- H1 title ---- */
  let titleIdx = -1;
  for (let i = first; i <= last && i < first + 3; i++) {
    if (H1_RE.test(lines[i])) { titleIdx = i; break; }
  }
  if (titleIdx === -1) {
    issues.push({
      severity: 'error',
      line: first + 1,
      message: 'Missing H1 title',
      fix: 'Start the file with a single H1: "# Your Site Name" on the first line.',
    });
  } else if (lines[titleIdx].trim() === '#') {
    issues.push({ severity: 'error', line: titleIdx + 1, message: 'Title line is empty' });
  }
  // more than one H1 anywhere → warn
  let h1Count = 0;
  for (let i = first; i <= last; i++) if (H1_RE.test(lines[i])) h1Count++;
  if (h1Count > 1) {
    issues.push({
      severity: 'warn',
      line: null,
      message: 'Multiple H1 lines found',
      fix: 'Keep exactly one H1 title at the top; use ## for sections.',
    });
  }

  /* ---- blockquote summary (below the title) ---- */
  let summaryIdx = -1;
  if (titleIdx >= 0) {
    for (let i = titleIdx + 1; i <= last && i <= titleIdx + 2; i++) {
      if (SUMMARY_RE.test(lines[i])) { summaryIdx = i; break; }
    }
  }
  if (titleIdx >= 0 && summaryIdx === -1) {
    // Report where the summary should sit: the first content line after the
    // title (or right after the title if the file ends there).
    let hint = titleIdx + 2;
    for (let i = titleIdx + 1; i <= last; i++) {
      if (lines[i].trim() !== '') { hint = i; break; }
    }
    issues.push({
      severity: 'error',
      line: hint + 1,
      message: 'Missing blockquote summary',
      fix: 'Add a "> " line directly below the title summarising the site — LLMs read it first.',
    });
  }

  /* ---- optional H2 structure ---- */
  let h2Count = 0;
  for (let i = first; i <= last; i++) if (H2_RE.test(lines[i])) h2Count++;
  if (h2Count === 0) {
    issues.push({
      severity: 'suggestion',
      line: null,
      message: 'No H2 sections found',
      fix: 'Optional: group links under ## headings (e.g. "## Key pages") so long files are easier for LLMs to navigate.',
    });
  }

  /* ---- link lines & hygiene ---- */
  const seenUrls = new Map<string, number>();
  let linkCount = 0;
  let hasFullLink = false;
  for (let i = first; i <= last; i++) {
    const line = lines[i].trim();
    if (line === '') continue;

    if (LINK_RE.test(line)) {
      linkCount++;
      const m = line.match(LINK_RE)!;
      const url = m[2];
      if (/^http:\/\//i.test(url)) {
        issues.push({
          severity: 'warn',
          line: i + 1,
          message: 'Link uses http:// instead of https://',
          fix: `Rewrite as ${url.replace(/^http:/i, 'https:')}`,
        });
      }
      if (!m[3] || !m[3].trim()) {
        issues.push({
          severity: 'suggestion',
          line: i + 1,
          message: 'Link has no description',
          fix: 'Add ": short description" after the URL — described links give LLMs more context.',
        });
      }
      if (seenUrls.has(url)) {
        issues.push({
          severity: 'warn',
          line: i + 1,
          message: `Duplicate link URL (first seen on line ${seenUrls.get(url)})`,
          fix: 'Each page should appear once in llms.txt.',
        });
      } else {
        seenUrls.set(url, i + 1);
      }
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      issues.push({
        severity: 'warn',
        line: i + 1,
        message: 'Bare URL without a "- [Title](url)" wrapper',
        fix: 'Convert to markdown link form: "- [Page Title](url): description".',
      });
    } else if (line.startsWith('- ')) {
      issues.push({
        severity: 'warn',
        line: i + 1,
        message: 'Unrecognized list item format',
        fix: 'Use "- [Page Title](https://url): description".',
      });
    }

    if (/\[llms-full\.txt\]\(/i.test(line)) hasFullLink = true;
  }
  if (linkCount === 0) {
    issues.push({
      severity: 'error',
      line: null,
      message: 'No page links found',
      fix: 'Add at least one "- [Page Title](url): description" line.',
    });
  }
  if (linkCount > 20 && !hasFullLink) {
    issues.push({
      severity: 'suggestion',
      line: null,
      message: 'More than 20 links, but no llms-full.txt reference',
      fix: 'Add an optional "[llms-full.txt](https://yoursite.com/llms-full.txt)" link and keep the index short.',
    });
  }
  if (hasFullLink) {
    const fullLine = lines.findIndex((l) => /\[llms-full\.txt\]\(/i.test(l));
    const fullUrl = lines[fullLine]?.match(/\]\((https?:\/\/[^)\s]+)\)/)?.[1];
    if (fullUrl && /^http:\/\//i.test(fullUrl)) {
      issues.push({
        severity: 'warn',
        line: fullLine + 1,
        message: 'llms-full.txt link uses http://',
        fix: `Rewrite as ${fullUrl.replace(/^http:/i, 'https:')}`,
      });
    }
  }

  return issues;
}
