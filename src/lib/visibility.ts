/**
 * AI Visibility scoring engine — L1 (public-site signals).
 *
 * Pure data + pure logic: no DOM, no Workers APIs, no network. The Cloudflare
 * Pages Function (functions/api/visibility-check.ts) fetches the public files
 * and hands them to `analyzeVisibility()`; the same function can be exercised
 * from a test script without a browser.
 *
 * The four dimensions mirror the product model, five checks each, five points
 * per check (25 per dimension, 100 total). `partial` earns 3/5.
 *
 * Important: this release does NOT query ChatGPT/Gemini/Perplexity. The
 * fourth dimension therefore measures *access* (can AI crawlers reach and
 * parse the site), not live mentions in AI answers. The copy on the page and
 * in the API report says so explicitly.
 */

import { parse, type HTMLElement } from 'node-html-parser';
import { analyzeRobotsTxt } from './robots';
import type { BotStatus, BotStatusRow } from './robots';

/* --------------------------------- Types -------------------------------- */

export type CheckStatus = 'pass' | 'partial' | 'fail';
export type DimensionId = 'brand' | 'content' | 'citation' | 'access';
export type Grade = 'excellent' | 'good' | 'fair' | 'poor';

export interface VisibilityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  points: number;
  max: number;
  /** What was found on the page — safe to show to the visitor. */
  evidence: string;
  /** One actionable sentence describing how to earn the missing points. */
  fix: string;
}

export interface VisibilityDimension {
  id: DimensionId;
  name: string;
  score: number;
  max: number;
  checks: VisibilityCheck[];
}

export interface BrandInfo {
  name: string;
  source: 'schema' | 'og' | 'title' | 'none';
  /** Every distinct name we saw, for the "why did it score this?" note. */
  aliases: string[];
}

export interface SignalSummary {
  title: string;
  title_length: number;
  description_length: number;
  words: number;
  h1: number;
  h2: number;
  h3: number;
  schema_types: string[];
  same_as: number;
  external_links: number;
  canonical: string | null;
  date_modified: string | null;
  robots_status: number | null;
  llms_status: number | null;
  sitemap_status: number | null;
  sitemap_url: string | null;
}

export interface VisibilityInput {
  /** The URL the visitor typed, already normalized. */
  url: string;
  /** The URL that served the homepage after redirects. */
  finalUrl: string;
  html: string;
  htmlTruncated?: boolean;
  /** null when the file was not fetched (network failure, HTML response…). */
  robotsText: string | null;
  robotsStatus: number | null;
  llmsText: string | null;
  llmsStatus: number | null;
  sitemapText: string | null;
  sitemapStatus: number | null;
  /** The URL the sitemap was actually read from (conventional or declared). */
  sitemapUrl?: string | null;
  /** X-Robots-Tag response header, if any. */
  xRobotsTag?: string | null;
  /** ISO timestamp used for freshness scoring (keeps tests deterministic). */
  fetchedAt?: string;
}

export interface VisibilityReport {
  total: number;
  grade: Grade;
  brand: BrandInfo;
  dimensions: VisibilityDimension[];
  warnings: string[];
  signals: SignalSummary;
}

/* -------------------------------- Helpers ------------------------------- */

const CHECK_MAX = 5;
const CHECK_PARTIAL = 3;

function check(
  id: string,
  label: string,
  status: CheckStatus,
  evidence: string,
  fix: string,
): VisibilityCheck {
  const points =
    status === 'pass' ? CHECK_MAX : status === 'partial' ? CHECK_PARTIAL : 0;
  return { id, label, status, points, max: CHECK_MAX, evidence, fix };
}

function dimension(
  id: DimensionId,
  name: string,
  checks: VisibilityCheck[],
): VisibilityDimension {
  return {
    id,
    name,
    score: checks.reduce((sum, c) => sum + c.points, 0),
    max: checks.reduce((sum, c) => sum + c.max, 0),
    checks,
  };
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function resolveUrl(href: string, base: string): URL | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function sameSite(url: URL, finalHost: string): boolean {
  const host = normalizeHost(url.hostname);
  return (
    host === finalHost ||
    host.endsWith(`.${finalHost}`) ||
    finalHost.endsWith(`.${host}`)
  );
}

function countWords(text: string): number {
  const latin =
    text.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g)?.length ?? 0;
  // CJK scripts do not use spaces; counting characters is the closest proxy.
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿가-힯]/g)?.length ?? 0;
  return latin + cjk;
}

function ageInDays(iso: string, nowMs: number): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((nowMs - ms) / 86_400_000));
}

function humanDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toISOString().slice(0, 10);
}

/* ------------------------------ Page parsing ---------------------------- */

const SOCIAL_HOSTS = [
  'twitter.com',
  'x.com',
  'facebook.com',
  'linkedin.com',
  'instagram.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'threads.net',
  'reddit.com',
  'medium.com',
];

function isSocialHost(host: string): boolean {
  const h = normalizeHost(host);
  return SOCIAL_HOSTS.some((social) => h === social || h.endsWith(`.${social}`));
}

const ORG_TYPES = new Set([
  'organization',
  'localbusiness',
  'corporation',
  'store',
  'professionalservice',
  'educationalorganization',
  'ngo',
  'nonprofitorganization',
  'governmentorganization',
  'brand',
]);

const CITABLE_TYPES = new Set([
  'faqpage',
  'qapage',
  'howto',
  'article',
  'blogposting',
  'newsarticle',
  'techarticle',
  'analysisnewsarticle',
]);

interface Entity {
  types: string[];
  name: string;
}

interface PageData {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogSiteName: string;
  lang: string;
  metaRobots: string;
  canonical: string;
  favicon: string;
  h1: number;
  h2: number;
  h3: number;
  words: number;
  paragraphs: number;
  lists: number;
  tables: number;
  blockquotes: number;
  externalHosts: Set<string>;
  aboutLink: boolean;
  contactLink: boolean;
  schemaTypes: Set<string>;
  entities: Entity[];
  sameAs: string[];
  schemaLogo: string;
  authorName: string;
  authorUrl: string;
  datePublished: string;
  dateModified: string;
  timeDatetime: string;
}

function attr(el: HTMLElement | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? '';
}

function typesOf(obj: Record<string, unknown>): string[] {
  const raw = obj['@type'];
  if (typeof raw === 'string') return [raw.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
  }
  return [];
}

/** Walk every object in a JSON-LD document, including @graph and nested nodes. */
function walkJsonLd(value: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkJsonLd(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  visit(obj);
  for (const nested of Object.values(obj)) walkJsonLd(nested, visit);
}

/**
 * Pull JSON-LD out and drop non-content blocks before parsing. This keeps the
 * DOM small (and CPU cost low on Workers) for script/style-heavy pages.
 */
function splitHtml(html: string): { cleaned: string; jsonLdRaw: string[] } {
  const jsonLdRaw: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    if (/\btype\s*=\s*["']?application\/ld\+json["']?/i.test(match[1] ?? '')) {
      jsonLdRaw.push(match[2] ?? '');
    }
  }

  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');

  return { cleaned, jsonLdRaw };
}

function parseJsonLdBlocks(rawBlocks: string[]): unknown[] {
  const blocks: unknown[] = [];
  for (const raw of rawBlocks) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      blocks.push(JSON.parse(trimmed));
    } catch {
      // A malformed block is not worth failing the whole analysis — the other
      // blocks usually still parse.
    }
  }
  return blocks;
}

function readPage(html: string, finalUrl: string): PageData {
  const { cleaned, jsonLdRaw } = splitHtml(html);
  const doc = parse(cleaned, {
    lowerCaseTagName: false,
    comment: false,
    blockTextElements: { pre: true },
  });

  const title = doc.querySelector('title')?.textContent.trim() ?? '';

  const metaNames = new Map<string, string>();
  const metaProps = new Map<string, string>();
  for (const meta of doc.querySelectorAll('meta')) {
    const content = meta.getAttribute('content')?.trim() ?? '';
    const name = (meta.getAttribute('name') ?? '').toLowerCase().trim();
    const property = (meta.getAttribute('property') ?? '').toLowerCase().trim();
    if (name && !metaNames.has(name)) metaNames.set(name, content);
    if (property && !metaProps.has(property)) metaProps.set(property, content);
  }
  const metaContent = (key: string): string =>
    metaProps.get(key) || metaNames.get(key) || '';

  const description = metaContent('description');
  const ogTitle = metaContent('og:title');
  const ogDescription = metaContent('og:description');
  const ogImage = metaContent('og:image') || metaContent('og:image:url');
  const ogSiteName = metaContent('og:site_name');
  const lang = attr(doc.querySelector('html'), 'lang');
  const metaRobots = metaContent('robots');

  const linkRels = new Map<string, string>();
  for (const link of doc.querySelectorAll('link')) {
    const href = link.getAttribute('href')?.trim() ?? '';
    if (!href) continue;
    for (const rel of (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/)) {
      if (rel && !linkRels.has(rel)) linkRels.set(rel, href);
    }
  }
  const canonical = linkRels.get('canonical') ?? '';
  const favicon = linkRels.get('icon') ?? '';

  // Count every structural element in one DOM pass instead of seven queries.
  let h1 = 0;
  let h2 = 0;
  let h3 = 0;
  let paragraphs = 0;
  let lists = 0;
  let tables = 0;
  let blockquotes = 0;
  for (const node of doc.querySelectorAll('h1, h2, h3, p, ul, ol, table, blockquote, cite')) {
    switch (node.tagName.toLowerCase()) {
      case 'h1':
        h1 += 1;
        break;
      case 'h2':
        h2 += 1;
        break;
      case 'h3':
        h3 += 1;
        break;
      case 'p':
        paragraphs += 1;
        break;
      case 'ul':
      case 'ol':
        lists += 1;
        break;
      case 'table':
        tables += 1;
        break;
      case 'blockquote':
      case 'cite':
        blockquotes += 1;
        break;
    }
  }

  const finalHost = normalizeHost(new URL(finalUrl).hostname);
  const externalHosts = new Set<string>();
  let aboutLink = false;
  let contactLink = false;

  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = (anchor.getAttribute('href') ?? '').trim();
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) {
      continue;
    }
    const url = resolveUrl(href, finalUrl);
    if (!url) continue;
    const same = sameSite(url, finalHost);
    const path = url.pathname.toLowerCase();
    const text = anchor.textContent.trim().toLowerCase();

    if (same) {
      if (
        /(^|\/)(about|about-us|company|our-story|team|who-we-are)(\/|$|\.html?$)/.test(path) ||
        /^about( us)?\b/.test(text)
      ) {
        aboutLink = true;
      }
      if (
        /(^|\/)(contact|contact-us|get-in-touch|support|help)(\/|$|\.html?$)/.test(path) ||
        /^contact( us)?\b/.test(text)
      ) {
        contactLink = true;
      }
    } else if (!isSocialHost(url.hostname)) {
      externalHosts.add(normalizeHost(url.hostname));
    }
  }

  /* ----- JSON-LD ----- */
  const schemaTypes = new Set<string>();
  const entities: Entity[] = [];
  const sameAs = new Set<string>();
  let schemaLogo = '';
  let authorName = metaContent('author');
  let authorUrl = '';
  let datePublished = '';
  let dateModified = '';

  for (const block of parseJsonLdBlocks(jsonLdRaw)) {
    walkJsonLd(block, (obj) => {
      const types = typesOf(obj);
      for (const type of types) schemaTypes.add(type);

      const name = typeof obj.name === 'string' ? obj.name.trim() : '';
      const isEntity = types.some((type) => ORG_TYPES.has(type) || type === 'person' || type === 'website');
      if (isEntity && name) {
        const exists = entities.some(
          (entity) => entity.name === name && entity.types.join('|') === types.join('|'),
        );
        if (!exists) entities.push({ types, name });
      }

      const rawSameAs = obj.sameAs;
      if (typeof rawSameAs === 'string') sameAs.add(rawSameAs.trim());
      if (Array.isArray(rawSameAs)) {
        for (const value of rawSameAs) {
          if (typeof value === 'string' && value.trim()) sameAs.add(value.trim());
        }
      }

      if (!schemaLogo && types.some((type) => ORG_TYPES.has(type) || type === 'website')) {
        const rawLogo = obj.logo;
        if (typeof rawLogo === 'string') schemaLogo = rawLogo.trim();
        else if (rawLogo && typeof rawLogo === 'object') {
          const logoUrl = (rawLogo as Record<string, unknown>).url;
          if (typeof logoUrl === 'string') schemaLogo = logoUrl.trim();
        }
      }

      if (!authorName || !authorUrl) {
        const rawAuthor = obj.author;
        const readAuthor = (value: unknown): void => {
          if (typeof value === 'string') {
            if (!authorName) authorName = value.trim();
            return;
          }
          if (!value || typeof value !== 'object' || Array.isArray(value)) return;
          const author = value as Record<string, unknown>;
          if (!authorName && typeof author.name === 'string') authorName = author.name.trim();
          if (!authorUrl && typeof author.url === 'string') authorUrl = author.url.trim();
        };
        if (Array.isArray(rawAuthor)) rawAuthor.forEach(readAuthor);
        else readAuthor(rawAuthor);
      }

      if (!datePublished && typeof obj.datePublished === 'string') {
        datePublished = obj.datePublished;
      }
      if (!dateModified && typeof obj.dateModified === 'string') {
        dateModified = obj.dateModified;
      }
    });
  }

  const metaPublished =
    metaContent('article:published_time') || metaContent('datepublished');
  const metaModified =
    metaContent('article:modified_time') || metaContent('og:updated_time');
  const timeDatetime = attr(doc.querySelector('time[datetime]'), 'datetime');
  if (!datePublished) datePublished = metaPublished || timeDatetime;
  if (!dateModified) dateModified = metaModified || timeDatetime;

  const authorLink =
    linkRels.get('author') ||
    attr(doc.querySelector('a[rel="author"]'), 'href');

  /* ----- Body text ----- */
  // Non-content blocks were dropped before parsing, so the body text is clean.
  const body = doc.querySelector('body') ?? doc;
  const words = countWords(body.textContent.replace(/\s+/g, ' ').trim());

  return {
    title,
    description,
    ogTitle,
    ogDescription,
    ogImage,
    ogSiteName,
    lang,
    metaRobots,
    canonical,
    favicon,
    h1,
    h2,
    h3,
    words,
    paragraphs,
    lists,
    tables,
    blockquotes,
    externalHosts,
    aboutLink,
    contactLink,
    schemaTypes,
    entities,
    sameAs: [...sameAs],
    schemaLogo,
    authorName,
    authorUrl: authorUrl || authorLink,
    datePublished,
    dateModified,
    timeDatetime,
  };
}

/* ------------------------------ Brand helpers --------------------------- */

function brandFromTitle(title: string): string {
  const parts = title
    .split(/\s+[|–—·•]\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last.length >= 2 && last.length <= 40) return last;
  }
  return title.trim();
}

function detectBrand(page: PageData): BrandInfo {
  const org = page.entities.find(
    (entity) => entity.name && entity.types.some((type) => ORG_TYPES.has(type)),
  );
  const site = page.entities.find((entity) => entity.name && entity.types.includes('website'));
  const person = page.entities.find((entity) => entity.name && entity.types.includes('person'));
  const titleBrand = page.title ? brandFromTitle(page.title) : '';

  const aliases = [
    org?.name,
    site?.name,
    person?.name,
    page.ogSiteName,
    titleBrand,
  ].filter((value): value is string => Boolean(value && value.trim()));

  const unique = [...new Set(aliases)];

  if (org) return { name: org.name, source: 'schema', aliases: unique };
  if (site) return { name: site.name, source: 'schema', aliases: unique };
  // og:site_name is a stronger brand signal than an author Person entity.
  if (page.ogSiteName) return { name: page.ogSiteName, source: 'og', aliases: unique };
  if (person) return { name: person.name, source: 'schema', aliases: unique };
  if (titleBrand) return { name: titleBrand, source: 'title', aliases: unique };
  return { name: '', source: 'none', aliases: [] };
}

function entityName(page: PageData): string {
  return detectBrand(page).name;
}

/* ------------------------------ Robots helpers -------------------------- */

function botWeight(status: BotStatus): number {
  if (status === 'allowed') return 1;
  if (status === 'default_allowed') return 0.5;
  return 0;
}

function botStatusLabel(status: BotStatus): string {
  if (status === 'allowed') return 'allowed';
  if (status === 'default_allowed') return 'default';
  return 'blocked';
}

function botCheck(
  id: string,
  label: string,
  names: string[],
  rows: BotStatusRow[],
  fix: string,
): VisibilityCheck {
  const found = names.map((name) => rows.find((row) => row.name === name));
  const weight =
    found.reduce((sum, row) => sum + (row ? botWeight(row.status) : 0), 0) / names.length;
  const status: CheckStatus = weight >= 0.8 ? 'pass' : weight >= 0.5 ? 'partial' : 'fail';
  const evidence = found
    .map((row, index) => `${names[index]} ${row ? botStatusLabel(row.status) : 'unknown'}`)
    .join(' · ');
  return check(id, label, status, evidence, fix);
}

/* -------------------------------- Checks -------------------------------- */

function brandChecks(page: PageData, brand: BrandInfo): VisibilityCheck[] {
  const hasOrg = page.entities.some(
    (entity) => entity.name && entity.types.some((type) => ORG_TYPES.has(type)),
  );
  const hasWebsite = page.schemaTypes.has('website');
  const schemaTypes = [...page.schemaTypes].filter(Boolean);
  const typeLabel = schemaTypes.slice(0, 6).join(', ') || 'none';

  const entityCheck = check(
    'entity-schema',
    'Entity schema',
    hasOrg ? 'pass' : hasWebsite ? 'partial' : 'fail',
    hasOrg
      ? `Found ${typeLabel} JSON-LD with a named entity.`
      : hasWebsite
        ? 'Only WebSite schema found — no Organization, LocalBusiness or Person entity.'
        : 'No Organization, LocalBusiness or Person JSON-LD found.',
    'Add Organization (or LocalBusiness/Person) JSON-LD with a stable name, url and logo.',
  );

  const sameAs = [...new Set(page.sameAs.map((url) => url.trim()).filter(Boolean))];
  const sameAsCheck = check(
    'same-as',
    'sameAs profiles',
    sameAs.length >= 2 ? 'pass' : sameAs.length === 1 ? 'partial' : 'fail',
    sameAs.length > 0
      ? `${sameAs.length} profile link${sameAs.length === 1 ? '' : 's'}: ${sameAs
          .slice(0, 3)
          .map((url) => {
            try {
              return new URL(url).hostname;
            } catch {
              return url;
            }
          })
          .join(', ')}.`
      : 'No sameAs profile links on the entity.',
    'Add at least two sameAs profiles (LinkedIn, X, GitHub, YouTube…) so AI systems can triangulate the brand.',
  );

  const entity = entityName(page) || brand.name;
  const sources = [entity, page.ogSiteName].filter(Boolean);
  const titleNorm = norm(page.title);
  let consistencyStatus: CheckStatus = 'fail';
  let consistencyEvidence = 'No brand name found in schema, og:site_name or title.';

  if (sources.length >= 2) {
    const [a, b] = sources.map(norm);
    const match = a === b || a.includes(b) || b.includes(a);
    const inTitle = sources.some((name) => norm(name) && titleNorm.includes(norm(name)));
    if (!match) {
      consistencyStatus = 'fail';
      consistencyEvidence = `Schema name "${sources[0]}" conflicts with og:site_name "${sources[1]}".`;
    } else if (inTitle) {
      consistencyStatus = 'pass';
      consistencyEvidence = `Schema and og:site_name agree on "${sources[0]}"; the title also contains it.`;
    } else {
      consistencyStatus = 'partial';
      consistencyEvidence = `Schema and og:site_name agree on "${sources[0]}", but the title does not contain it.`;
    }
  } else if (sources.length === 1) {
    consistencyStatus = 'partial';
    consistencyEvidence = `Only one name source: "${sources[0]}".`;
  }

  const consistencyCheck = check(
    'name-consistency',
    'Brand name consistency',
    consistencyStatus,
    consistencyEvidence,
    'Use the same brand name in Organization schema, og:site_name and the page title.',
  );

  const aboutContact = page.aboutLink && page.contactLink;
  const aboutContactCheck = check(
    'about-contact',
    'About & contact pages',
    aboutContact ? 'pass' : page.aboutLink || page.contactLink ? 'partial' : 'fail',
    aboutContact
      ? 'Homepage links to both an about page and a contact page.'
      : page.aboutLink
        ? 'Homepage links to an about page but not a contact page.'
        : page.contactLink
          ? 'Homepage links to a contact page but not an about page.'
          : 'No about or contact page links found on the homepage.',
    'Link to an about page (who you are) and a contact page (how to reach you) from the homepage.',
  );

  const logoCheck = check(
    'logo',
    'Logo or icon',
    page.schemaLogo ? 'pass' : page.favicon ? 'partial' : 'fail',
    page.schemaLogo
      ? `Organization logo declared: ${page.schemaLogo.slice(0, 120)}.`
      : page.favicon
        ? 'Only a favicon was found; no Organization logo in JSON-LD.'
        : 'No Organization logo or favicon found.',
    'Add a logo URL to Organization JSON-LD (and keep a favicon) so the brand has a visual identity.',
  );

  return [entityCheck, sameAsCheck, consistencyCheck, aboutContactCheck, logoCheck];
}

function contentChecks(page: PageData, nowMs: number): VisibilityCheck[] {
  const titleLen = page.title.length;
  const descLen = page.description.length;
  const titleOk = titleLen >= 15 && titleLen <= 65;
  const descOk = descLen >= 70 && descLen <= 160;
  const metaCheck = check(
    'title-description',
    'Title & meta description',
    titleOk && descOk ? 'pass' : titleOk || descOk ? 'partial' : 'fail',
    `Title ${titleLen} chars · description ${descLen} chars.`,
    'Keep the title between 15 and 65 characters and the meta description between 70 and 160.',
  );

  const headingOk = page.h1 === 1 && page.h2 >= 3;
  const headingPartial = page.h1 >= 1 && page.h2 >= 1;
  const headingCheck = check(
    'headings',
    'Heading structure',
    headingOk ? 'pass' : headingPartial ? 'partial' : 'fail',
    `${page.h1} H1 · ${page.h2} H2 · ${page.h3} H3.`,
    'Use exactly one H1 and at least three H2 sections so an answer engine can outline the page.',
  );

  const depthCheck = check(
    'depth',
    'Content depth',
    page.words >= 500 ? 'pass' : page.words >= 250 ? 'partial' : 'fail',
    `${page.words} words of server-rendered text.`,
    'Publish at least 500 words of substantive, server-rendered copy on the page.',
  );

  const structureOk = page.paragraphs >= 5 && page.lists + page.tables >= 1;
  const structurePartial = page.paragraphs >= 5 || page.lists + page.tables >= 1;
  const structureCheck = check(
    'structure',
    'Extractable structure',
    structureOk ? 'pass' : structurePartial ? 'partial' : 'fail',
    `${page.paragraphs} paragraphs · ${page.lists} lists · ${page.tables} tables.`,
    'Break content into short paragraphs, lists and tables so assistants can lift a complete answer.',
  );

  const newestDate = page.dateModified || page.datePublished || page.timeDatetime;
  let freshnessStatus: CheckStatus = 'fail';
  let freshnessEvidence = 'No datePublished, dateModified or <time datetime> found.';
  if (newestDate) {
    const age = ageInDays(newestDate, nowMs);
    if (age === null) {
      freshnessEvidence = `Unreadable date: ${newestDate}.`;
    } else {
      freshnessEvidence = `${humanDate(newestDate)} · ${age} days old.`;
      freshnessStatus = age <= 365 ? 'pass' : age <= 730 ? 'partial' : 'fail';
    }
  }
  const freshnessCheck = check(
    'freshness',
    'Freshness',
    freshnessStatus,
    freshnessEvidence,
    'Expose datePublished/dateModified in JSON-LD and refresh key pages at least yearly.',
  );

  return [metaCheck, headingCheck, depthCheck, structureCheck, freshnessCheck];
}

function citationChecks(page: PageData, finalUrl: string): VisibilityCheck[] {
  const external = [...page.externalHosts];
  const sourcesCheck = check(
    'outbound-sources',
    'Outbound sources',
    external.length >= 3 ? 'pass' : external.length > 0 ? 'partial' : 'fail',
    external.length > 0
      ? `${external.length} external source domain${external.length === 1 ? '' : 's'}: ${external
          .slice(0, 4)
          .join(', ')}.`
      : 'No external links to sources or references.',
    'Link to at least three authoritative external sources (studies, docs, data) next to the claims they support.',
  );

  const authorCheck = check(
    'author',
    'Author attribution',
    page.authorName && page.authorUrl ? 'pass' : page.authorName ? 'partial' : 'fail',
    page.authorName && page.authorUrl
      ? `Author "${page.authorName}" with a profile URL.`
      : page.authorName
        ? `Author "${page.authorName}" without a profile URL.`
        : 'No author name or author page found.',
    'Add author markup (name + bio URL) so an answer engine can attribute the claim.',
  );

  let canonicalStatus: CheckStatus = 'fail';
  let canonicalEvidence = 'No canonical link found.';
  if (page.canonical) {
    const canonicalUrl = resolveUrl(page.canonical, finalUrl);
    if (!canonicalUrl) {
      canonicalEvidence = `Canonical is not a usable URL: ${page.canonical}`;
    } else {
      const final = new URL(finalUrl);
      const sameHost = normalizeHost(canonicalUrl.hostname) === normalizeHost(final.hostname);
      const samePath =
        (canonicalUrl.pathname.replace(/\/+$/, '') || '/') ===
        (final.pathname.replace(/\/+$/, '') || '/');
      canonicalStatus = sameHost && samePath ? 'pass' : 'partial';
      canonicalEvidence = `Canonical: ${page.canonical}`;
    }
  }
  const canonicalCheck = check(
    'canonical',
    'Canonical URL',
    canonicalStatus,
    canonicalEvidence,
    'Point rel=canonical at the exact preferred URL (host + path) that served the page.',
  );

  const ogCount = [page.ogTitle, page.ogDescription, page.ogImage].filter(Boolean).length;
  const ogCheck = check(
    'open-graph',
    'Open Graph metadata',
    ogCount === 3 ? 'pass' : ogCount === 2 ? 'partial' : 'fail',
    `og:title ${page.ogTitle ? '✓' : '✗'} · og:description ${page.ogDescription ? '✓' : '✗'} · og:image ${page.ogImage ? '✓' : '✗'}.`,
    'Add og:title, og:description and og:image so the page has a clean social/answer-engine summary.',
  );

  const citableTypes = [...page.schemaTypes].filter((type) => CITABLE_TYPES.has(type));
  const citableStatus: CheckStatus = citableTypes.length
    ? 'pass'
    : page.blockquotes > 0 || page.tables > 0
      ? 'partial'
      : 'fail';
  const citableCheck = check(
    'citable-format',
    'Citable format',
    citableStatus,
    citableTypes.length
      ? `Structured content: ${citableTypes.join(', ')}.`
      : page.blockquotes > 0 || page.tables > 0
        ? 'No FAQ/HowTo/Article schema, but the page has quotes or tables.'
        : 'No FAQ/HowTo/Article schema and no quotes or tables.',
    'Add FAQPage/HowTo/Article schema, or format key answers as quotes, lists or tables.',
  );

  return [sourcesCheck, authorCheck, canonicalCheck, ogCheck, citableCheck];
}

function accessChecks(
  page: PageData,
  input: VisibilityInput,
  rows: BotStatusRow[],
): VisibilityCheck[] {
  const noindex = /\b(noindex|none)\b/i.test(page.metaRobots) || /\bnoindex\b/i.test(input.xRobotsTag ?? '');
  const crawlCheck = check(
    'crawlable',
    'Crawlable homepage',
    noindex ? 'fail' : 'pass',
    noindex
      ? 'noindex detected in meta robots or X-Robots-Tag.'
      : 'Homepage fetched; no noindex directive.',
    'Remove noindex from pages you want AI crawlers to read.',
  );

  const searchBots = botCheck(
    'ai-search-bots',
    'AI search crawlers',
    ['OAI-SearchBot', 'PerplexityBot', 'Claude-SearchBot', 'Bingbot'],
    rows,
    'Explicitly allow OAI-SearchBot, PerplexityBot, Claude-SearchBot and Bingbot in robots.txt — these crawlers feed answer engines.',
  );

  const otherBots = botCheck(
    'ai-training-bots',
    'Training & live-fetch crawlers',
    ['GPTBot', 'ClaudeBot', 'Google-Extended', 'ChatGPT-User', 'Claude-User'],
    rows,
    'Decide per crawler and declare it explicitly: GPTBot/ClaudeBot/Google-Extended for training, ChatGPT-User/Claude-User for live fetches.',
  );

  const llmsText = input.llmsText;
  let llmsStatus: CheckStatus = 'fail';
  let llmsEvidence =
    input.llmsStatus === null
      ? 'Could not read /llms.txt (network or timeout).'
      : input.llmsStatus === 200
        ? 'The file at /llms.txt is empty or not plain text.'
        : 'No /llms.txt found.';
  if (llmsText && llmsText.trim()) {
    const lines = llmsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const hasH1 = lines[0]?.startsWith('# ') ?? false;
    const sections = lines.filter((line) => line.startsWith('## ')).length;
    const links = (llmsText.match(/\]\((https?:\/\/|\/)/g) ?? []).length;
    const bytes = new TextEncoder().encode(llmsText).length;
    llmsStatus = hasH1 && (sections >= 1 || links >= 1) ? 'pass' : hasH1 ? 'partial' : 'fail';
    llmsEvidence = `${bytes} bytes · H1 ${hasH1 ? '✓' : '✗'} · ${sections} section${sections === 1 ? '' : 's'} · ${links} link${links === 1 ? '' : 's'}.`;
  }
  const llmsCheck = check(
    'llms-txt',
    'llms.txt',
    llmsStatus,
    llmsEvidence,
    'Publish /llms.txt with an H1, a one-line summary and H2 sections linking your key pages.',
  );

  let sitemapStatus: CheckStatus = 'fail';
  let sitemapEvidence =
    input.sitemapStatus === null
      ? 'Could not read /sitemap.xml (network or timeout).'
      : input.sitemapStatus === 200
        ? 'The file at /sitemap.xml is empty or not valid XML.'
        : 'No /sitemap.xml found.';
  if (input.sitemapText && input.sitemapText.trim()) {
    const urls = (input.sitemapText.match(/<loc\b[^>]*>/gi) ?? []).length;
    const isIndex = /<sitemapindex[\s>]/i.test(input.sitemapText);
    const isUrlset = /<urlset[\s>]/i.test(input.sitemapText);
    if (isIndex) {
      sitemapStatus = 'partial';
      sitemapEvidence = `Sitemap index with ${urls} child sitemap${urls === 1 ? '' : 's'}; only the index was checked.`;
    } else if (isUrlset && urls > 0) {
      sitemapStatus = 'pass';
      const source = input.sitemapUrl
        ? input.sitemapUrl.replace(/^https?:\/\//i, '').slice(0, 80)
        : '/sitemap.xml';
      sitemapEvidence = `${urls} URL${urls === 1 ? '' : 's'} in ${source}.`;
    } else if (urls > 0) {
      sitemapStatus = 'partial';
      sitemapEvidence = `${urls} <loc> entr${urls === 1 ? 'y' : 'ies'} but no <urlset> root.`;
    } else {
      sitemapEvidence = 'The file does not look like a sitemap.';
    }
  }
  const sitemapCheck = check(
    'sitemap',
    'XML sitemap',
    sitemapStatus,
    sitemapEvidence,
    'Publish /sitemap.xml with <urlset> and <loc> entries, and reference it from robots.txt.',
  );

  return [crawlCheck, searchBots, otherBots, llmsCheck, sitemapCheck];
}

/* ------------------------------- Warnings ------------------------------- */

function buildWarnings(
  page: PageData,
  input: VisibilityInput,
  finalUrl: string,
): string[] {
  const warnings: string[] = [];
  const requested = input.url.replace(/\/+$/, '');
  const final = finalUrl.replace(/\/+$/, '');
  if (requested && final && requested !== final) {
    warnings.push(`The homepage redirected to ${finalUrl}.`);
  }
  if (input.htmlTruncated) {
    warnings.push('The homepage HTML was truncated before analysis; some signals may be missing.');
  }
  if (input.robotsStatus === 404) {
    warnings.push('No robots.txt found — AI crawlers are allowed by default, but explicit rules are clearer.');
  } else if (input.robotsStatus === null) {
    warnings.push('We could not read robots.txt; crawler rules were treated as default. Retry before acting on the AI Access score.');
  } else if (input.robotsStatus === 200 && input.robotsText === null) {
    warnings.push('robots.txt returned a non-text response; crawler rules could not be read.');
  } else if (input.robotsStatus < 200 || input.robotsStatus >= 300) {
    warnings.push(`robots.txt returned HTTP ${input.robotsStatus}; crawler rules could not be read.`);
  }
  if (input.llmsStatus === 404) {
    warnings.push('No /llms.txt found — publishing one helps assistants find your key pages.');
  } else if (input.llmsStatus === null) {
    warnings.push('We could not read /llms.txt; it may be missing or the request failed.');
  } else if (input.llmsStatus === 200 && input.llmsText === null) {
    warnings.push('/llms.txt returned HTTP 200 but was not usable plain text.');
  }
  if (input.sitemapStatus === 404) {
    warnings.push('No /sitemap.xml found at the conventional path.');
  } else if (input.sitemapStatus === null) {
    warnings.push('We could not read /sitemap.xml; it may be missing or the request failed.');
  } else if (input.sitemapStatus === 200 && input.sitemapText === null) {
    warnings.push('/sitemap.xml returned HTTP 200 but was not usable XML.');
  }
  if (input.sitemapUrl && !/\/sitemap\.xml$/i.test(input.sitemapUrl)) {
    warnings.push(`Using the sitemap declared in robots.txt: ${input.sitemapUrl}.`);
  }
  if (page.words < 80) {
    warnings.push('Very little server-rendered text was found; the page may be JavaScript-rendered, which this checker cannot execute.');
  }
  return warnings;
}

/* -------------------------------- Engine -------------------------------- */

export function analyzeVisibility(input: VisibilityInput): VisibilityReport {
  const page = readPage(input.html, input.finalUrl);
  const brand = detectBrand(page);
  const nowMs = input.fetchedAt ? Date.parse(input.fetchedAt) : Date.now();
  const robots = analyzeRobotsTxt(input.robotsText ?? '');
  const rows = robots.bots_status;

  const dimensions: VisibilityDimension[] = [
    dimension('brand', 'Brand Entity', brandChecks(page, brand)),
    dimension('content', 'Content Signals', contentChecks(page, Number.isFinite(nowMs) ? nowMs : Date.now())),
    dimension('citation', 'Citation Readiness', citationChecks(page, input.finalUrl)),
    dimension('access', 'AI Access', accessChecks(page, input, rows)),
  ];

  const total = dimensions.reduce((sum, dim) => sum + dim.score, 0);
  const grade: Grade = total >= 85 ? 'excellent' : total >= 70 ? 'good' : total >= 50 ? 'fair' : 'poor';

  const newestDate = page.dateModified || page.datePublished || page.timeDatetime || null;

  return {
    total,
    grade,
    brand,
    dimensions,
    warnings: buildWarnings(page, input, input.finalUrl),
    signals: {
      title: page.title,
      title_length: page.title.length,
      description_length: page.description.length,
      words: page.words,
      h1: page.h1,
      h2: page.h2,
      h3: page.h3,
      schema_types: [...page.schemaTypes].slice(0, 20),
      same_as: page.sameAs.length,
      external_links: page.externalHosts.size,
      canonical: page.canonical || null,
      date_modified: newestDate,
      robots_status: input.robotsStatus,
      llms_status: input.llmsStatus,
      sitemap_status: input.sitemapStatus,
      sitemap_url: input.sitemapUrl ?? null,
    },
  };
}
