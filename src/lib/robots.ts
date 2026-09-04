/**
 * AI crawler database + analysis engine for the Robots.txt & Crawler Checker.
 *
 * Pure data + pure logic (no DOM, no Workers APIs) so the SAME module is
 * used by the Cloudflare Pages Function (functions/api/check-robots.ts) and
 * by the browser (robotsApp.ts paste mode / the static reference table).
 *
 * Spec (robots功能2.txt): three crawler classes, per-bot tri-state status
 * ('allowed' | 'disallowed' | 'default_allowed'), wildcard inheritance for
 * unmentioned bots, a 0-100 AI Crawlability score and GEO summaries.
 * The robots.txt *parsing* primitives live in robotsParser.ts.
 */

import type { RoboTxtRule, RobotsParseResult } from './robotsParser';
import {
  evaluateGroup,
  groupAppliesToToken,
  isWildcardGroup,
  parseRobotsTxt,
  ruleMatchesPath,
} from './robotsParser';

/* ------------------------------ Categories ------------------------------ */

export type BotCategory = 'ai-search' | 'training' | 'user-triggered';

export const CATEGORIES: BotCategory[] = [
  'ai-search',
  'training',
  'user-triggered',
];

export const CATEGORY_LABELS: Record<BotCategory, string> = {
  'ai-search': 'AI Search & Citation',
  training: 'Model Training',
  'user-triggered': 'User Triggered',
};

export const CATEGORY_BLURBS: Record<BotCategory, string> = {
  'ai-search':
    'Crawlers behind search and answer products — SearchGPT, Perplexity, Bing AI — whose answers cite your pages (direct GEO referral traffic).',
  training:
    'Crawlers that read the public web to train models and build knowledge bases.',
  'user-triggered':
    'Fetches a page only when a user asks — browse and search actions inside ChatGPT and Claude apps.',
};

/** Score weight per category: citation/search crawlers matter most for GEO. */
const CATEGORY_WEIGHT: Record<BotCategory, number> = {
  'ai-search': 3,
  training: 1,
  'user-triggered': 2,
};

/* ------------------------------ Bot database ---------------------------- */

export type BotStatus = 'allowed' | 'disallowed' | 'default_allowed';
export type BotSource = 'explicit' | 'wildcard' | 'none';

export interface AiBot {
  id: string;
  name: string;
  vendor: string;
  category: BotCategory;
  /** robots.txt user-agent token(s) this crawler listens to. */
  tokens: string[];
  /** What the crawler does — one line. */
  blurb: string;
  /** GEO impact when the crawler is blocked — one line. */
  geoImpact: string;
}

export const AI_BOTS: AiBot[] = [
  // ----- AI Search & Citation (GEO 引流) -----
  {
    id: 'oai-searchbot',
    name: 'OAI-SearchBot',
    vendor: 'OpenAI',
    category: 'ai-search',
    tokens: ['oai-searchbot'],
    blurb: 'The crawler that powers SearchGPT and ChatGPT search results.',
    geoImpact: 'Pages you want cited in ChatGPT search results must allow OAI-SearchBot.',
  },
  {
    id: 'perplexitybot',
    name: 'PerplexityBot',
    vendor: 'Perplexity',
    category: 'ai-search',
    tokens: ['perplexitybot', 'perplexity-user'],
    blurb: 'Fetches pages for Perplexity answers and API-backed products.',
    geoImpact: 'Perplexity cites what it crawls — an explicit Allow wins you coverage in answers.',
  },
  {
    id: 'bingbot',
    name: 'Bingbot',
    vendor: 'Microsoft',
    category: 'ai-search',
    tokens: ['bingbot'],
    blurb: 'The classic Bing crawler — also the fetch layer behind Bing AI / Copilot citations.',
    geoImpact: 'Blocking Bingbot removes pages from Bing organic results AND Bing AI answers.',
  },

  // ----- AI Model Training -----
  {
    id: 'gptbot',
    name: 'GPTBot',
    vendor: 'OpenAI',
    category: 'training',
    tokens: ['gptbot'],
    blurb: 'OpenAI\'s web crawler for model training and knowledge retrieval.',
    geoImpact: 'Blocking GPTBot keeps your content out of OpenAI model training.',
  },
  {
    id: 'claudebot',
    name: 'ClaudeBot',
    vendor: 'Anthropic',
    category: 'training',
    tokens: ['claudebot'],
    blurb: 'Anthropic\'s crawler for Claude model training and knowledge retrieval.',
    geoImpact: 'Claude can only cite and learn from pages ClaudeBot is allowed to read.',
  },
  {
    id: 'google-extended',
    name: 'Google-Extended',
    vendor: 'Google',
    category: 'training',
    tokens: ['google-extended'],
    blurb: 'The opt-out token for Google AI training, AI Overviews and Vertex AI grounding.',
    geoImpact: 'Blocking it keeps your content out of Google AI features; classic search is unaffected.',
  },
  {
    id: 'ccbot',
    name: 'CCBot',
    vendor: 'Common Crawl',
    category: 'training',
    tokens: ['ccbot'],
    blurb: 'The open web corpus many LLM vendors train on, directly or indirectly.',
    geoImpact: 'A CCBot block does not stop GPTBot or ClaudeBot — every crawler needs its own rule.',
  },

  // ----- User-Triggered (实时交互) -----
  {
    id: 'chatgpt-user',
    name: 'ChatGPT-User',
    vendor: 'OpenAI',
    category: 'user-triggered',
    tokens: ['chatgpt-user'],
    blurb: 'Fetches pages on-demand when a ChatGPT user browses or searches the web.',
    geoImpact: 'Live ChatGPT browsing cannot surface pages that block ChatGPT-User.',
  },
  {
    id: 'claude-web',
    name: 'Claude-Web',
    vendor: 'Anthropic',
    category: 'user-triggered',
    tokens: ['claude-web', 'anthropic-ai'],
    blurb: 'Fetch layer for user-initiated actions in the Claude web and mobile apps.',
    geoImpact: 'Pages stay unreachable from live Claude sessions while Claude-Web is blocked.',
  },
];

/** The display token for a bot (first alias, as written in robots.txt). */
export function primaryToken(bot: AiBot): string {
  return bot.tokens[0];
}

/* ------------------------------ Analysis --------------------------------- */

export interface BotStatusRow {
  name: string;
  vendor: string;
  category: BotCategory;
  ua_token: string;
  status: BotStatus;
  /** How the governing rules were found. */
  source: BotSource;
  /** The decisive rule line ('' when nothing matched). */
  rule_line: string;
  /** Non-root paths this crawler is denied ('' when none). */
  restrictions: string;
  /** GEO reason this row matters. */
  impact: string;
}

export interface Analysis {
  /** 0-100 AI Crawlability Score (weighted per category). */
  score: number;
  bots_status: BotStatusRow[];
  /** Short GEO summaries for flagged bots. */
  summary: string[];
}

/**
 * Wildcard inheritance per spec: a crawler with no *named* group falls back
 * to the `User-agent: *` group (or to "allowed by default" when there is no
 * wildcard group either). A named group always beats the wildcard.
 */
function effectiveGroup(
  parsed: RobotsParseResult,
  bot: AiBot,
): { rules: RoboTxtRule[]; source: BotSource } {
  const named = parsed.groups.filter((g) =>
    bot.tokens.some((t) => groupAppliesToToken(g.tokens, t)),
  );
  if (named.length > 0) {
    return { rules: named.flatMap((g) => g.rules), source: 'explicit' };
  }
  const wildcard = parsed.groups.filter(isWildcardGroup);
  if (wildcard.length > 0) {
    return { rules: wildcard.flatMap((g) => g.rules), source: 'wildcard' };
  }
  return { rules: [], source: 'none' };
}

function verdictOf(
  rules: RoboTxtRule[],
  path: string,
): { allow: boolean; rule: RoboTxtRule | null } {
  return evaluateGroup({ tokens: [], rules }, path);
}

/** Inherited-from-wildcard flag used in rule_line phrasing. */
function formatRuleLine(
  source: BotSource,
  status: BotStatus,
  rule: RoboTxtRule | null,
  restrictions: string[],
): string {
  if (status === 'disallowed' && rule) {
    return source === 'wildcard'
      ? `${rule.kind}: ${rule.pattern} (inherited from User-agent: *)`
      : `${rule.kind}: ${rule.pattern}`;
  }
  if (status === 'allowed' && rule) return `${rule.kind}: ${rule.pattern}`;
  if (source === 'wildcard') return 'Allowed via User-agent: *';
  if (restrictions.length > 0) return `Allowed (restricts ${restrictions.join(', ')})`;
  return 'No blocking rule';
}

/**
 * Analyse a robots.txt document against the 9 monitored AI crawlers.
 * Produces the API / UI contract: score, bots_status, summary.
 */
export function analyzeRobotsTxt(text: string): Analysis {
  const parsed: RobotsParseResult = parseRobotsTxt(text);
  const rows: BotStatusRow[] = AI_BOTS.map((bot) => {
    const { rules, source } = effectiveGroup(parsed, bot);
    const { allow, rule } = verdictOf(rules, '/');

    const restrictions = rules.filter(
      (r) => r.kind === 'disallow' && !ruleMatchesPath(r, '/'),
    );
    // Effective tri-state (spec): explicit rules win; otherwise inherit the
    // wildcard group; without any group access is allowed by default.
    let status: BotStatus;
    if (!allow) status = 'disallowed';
    else if (source === 'explicit') status = 'allowed';
    else status = 'default_allowed';

    return {
      name: bot.name,
      vendor: bot.vendor,
      category: bot.category,
      ua_token: primaryToken(bot),
      status,
      source,
      rule_line: formatRuleLine(
        source,
        status,
        rule,
        restrictions.map((r) => r.pattern),
      ),
      restrictions: restrictions.map((r) => r.pattern).join(', '),
      impact: bot.geoImpact,
    };
  });

  // Order rows by category then declaration order.
  const ordered = CATEGORIES.flatMap((cat) => rows.filter((r) => r.category === cat));

  const score = computeScore(ordered);

  const summary = buildSummary(ordered);
  return { score, bots_status: ordered, summary };
}

function computeScore(rows: BotStatusRow[]): number {
  const weightFor = (r: BotStatusRow): number =>
    CATEGORY_WEIGHT[r.category] ?? 1;
  const gained = rows.reduce((acc, r) => {
    const w = weightFor(r);
    if (r.status === 'disallowed') return acc;
    if (r.status === 'default_allowed') return acc + w * 0.5;
    return acc + w;
  }, 0);
  const total = rows.reduce((acc, r) => acc + weightFor(r), 0);
  return Math.round((gained / total) * 100);
}

function buildSummary(rows: BotStatusRow[]): string[] {
  const out: string[] = [];
  const blocked = rows.filter((r) => r.status === 'disallowed');
  const unconfigured = rows.filter((r) => r.status === 'default_allowed');

  if (blocked.length > 0) {
    out.push(
      `You block ${blocked.map((r) => r.name).join(', ')} — for GEO visibility, review the rules in your robots.txt.`,
    );
  }
  for (const r of blocked) {
    if (r.source === 'wildcard') {
      out.push(
        `${r.name} has no rule of its own: it is blocked through the inherited User-agent: * rule. ${r.impact}`,
      );
    } else {
      out.push(`${r.name} is blocked (${r.rule_line}). ${r.impact}`);
    }
  }
  for (const r of unconfigured) {
    out.push(
      `${r.name} is not configured explicitly — an explicit rule makes your intent clear. ${r.impact}`,
    );
  }
  if (blocked.length === 0 && unconfigured.length === 0) {
    out.push('All monitored AI crawlers are explicitly allowed — your robots.txt is AI-ready.');
  }
  return out;
}

/* ---------------------------- Snippet builders --------------------------- */

/** `User-agent: <token>\nAllow: /` for one crawler. */
export function perBotRuleText(uaToken: string): string {
  return `User-agent: ${uaToken}\nAllow: /`;
}

/**
 * A ready-to-paste block that explicitly allows every monitored crawler that
 * is not already explicitly allowed (blocked or default-allowed).
 */
export function buildAllowSnippet(rows: BotStatusRow[]): string {
  const targets = rows.filter((r) => r.status !== 'allowed');
  if (targets.length === 0) return '';
  const lines = targets
    .map((r) => `${perBotRuleText(r.ua_token)}\n`)
    .join('\n');
  return [
    '# AI crawler allow-list — generated by AIGEOKit',
    '# Review per-crawler before deploying: allowing a crawler may also permit',
    '# model-training use of your public content.',
    '',
    lines,
  ].join('\n');
}

