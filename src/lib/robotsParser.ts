/**
 * robots.txt parser + rule matcher (RFC 9309 style, Google precedence).
 *
 * Pure TypeScript — no DOM, no Workers APIs — so the same module is used by:
 *   - the Cloudflare Pages Function (functions/api/check-robots.ts)
 *   - the browser controller (src/lib/robotsApp.ts) for paste-mode checks
 */

export interface RoboTxtRule {
  kind: 'allow' | 'disallow';
  /** Raw pattern as written (kept verbatim for display/evidence). */
  pattern: string;
}

export interface RoboGroup {
  /** Lower-cased user-agent tokens, e.g. ['gptbot', 'chatgpt-user']. */
  tokens: string[];
  rules: RoboTxtRule[];
}

export interface RobotsParseResult {
  groups: RoboGroup[];
  warnings: string[];
}

const UA_RE = /^user-agent\s*:/i;
const RULE_RE = /^(allow|disallow)\s*:/i;

/** Strip inline comments: '#' starts a comment anywhere in a line. */
function stripComment(line: string): string {
  const i = line.indexOf('#');
  return i === -1 ? line : line.slice(0, i);
}

function parseLine(line: string): { key: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  return {
    key: line.slice(0, colon).trim().toLowerCase(),
    value: line.slice(colon + 1).trim(),
  };
}

/**
 * Parse a robots.txt document into ordered user-agent groups.
 * RFC 9309 grouping: consecutive `user-agent:` lines before any rule line
 * form ONE group (multiple tokens); the first rule line seals the head, so
 * a later `user-agent:` line opens a new group.
 */
export function parseRobotsTxt(text: string): RobotsParseResult {
  const groups: RoboGroup[] = [];
  const warnings: string[] = [];

  // Strip UTF-8 BOM; then process line by line.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r\n|\r|\n/);

  let current: RoboGroup | null = null;
  let headSealed = false; // a rule has been seen in the current group

  const startNewGroup = (tokens: string[]): RoboGroup => {
    const g: RoboGroup = { tokens, rules: [] };
    groups.push(g);
    return g;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]).trim();
    if (!raw) continue;

    const field = parseLine(raw);

    if (field && UA_RE.test(raw)) {
      // "User-agent: gptbot, chatgpt-user" — split on commas AND whitespace
      // so sloppy space-separated multi-UA lines still behave sensibly.
      const tokens = field.value
        .split(/[\s,]+/)
        .map((t) => t.toLowerCase())
        .filter(Boolean);
      if (tokens.length === 0) {
        warnings.push(`line ${i + 1}: empty user-agent token ignored`);
        continue;
      }
      if (!current || headSealed) {
        current = startNewGroup(tokens);
        headSealed = false;
      } else {
        // Consecutive UA lines merge into the open group.
        current.tokens.push(...tokens);
      }
      continue;
    }

    if (field && RULE_RE.test(raw)) {
      const kind = field.key === 'allow' ? 'allow' : 'disallow';
      const pattern = field.value;
      if (!pattern) {
        // `Disallow:` with no value removes restrictions — that is our
        // default anyway, so the rule is a no-op. `Allow:` empty is invalid.
        warnings.push(`line ${i + 1}: empty "${field.key}" value ignored`);
        continue;
      }
      if (!current) {
        warnings.push(`line ${i + 1}: rule before any user-agent line ignored`);
        continue;
      }
      current.rules.push({ kind, pattern });
      headSealed = true;
      continue;
    }

    // Anything else (sitemap:, crawl-delay:, unknown fields, stray text)
    // never affects allow/disallow verdicts.
  }

  // Drop empty groups that never received rules — they neither allow nor block.
  const usable = groups.filter((g) => g.rules.length > 0);
  for (const g of groups) {
    if (g.rules.length === 0 && g.tokens.length > 0) {
      warnings.push(
        `group for "${g.tokens.join(', ')}" has no allow/disallow rules`,
      );
    }
  }
  return { groups: usable, warnings };
}

/**
 * True when a group token applies to a crawler token.
 * Both sides are lower-cased by callers; comparison is exact per RFC 9309
 * (a `user-agent` token names the crawler, not a prefix of its UA string).
 */
export function groupAppliesToToken(groupTokens: string[], botToken: string): boolean {
  const want = botToken.toLowerCase();
  return groupTokens.some((t) => t === want);
}

/** Does `group` contain the wildcard `*` token (applies to every crawler)? */
export function isWildcardGroup(group: RoboGroup): boolean {
  return group.tokens.some((t) => t === '*');
}

/** A '*' inside a pattern matches any sequence (incl. empty); a trailing '$'
 * anchors the end. Everything else is matched literally. */
function patternToRegExp(pattern: string): RegExp {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      src += '.*';
    } else if (ch === '$' && i === pattern.length - 1) {
      src += '$';
    } else {
      src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${src}`);
}

/** Match a rule pattern against a URL path (e.g. '/' or '/private/'). */
export function ruleMatchesPath(rule: RoboTxtRule, path: string): boolean {
  try {
    return patternToRegExp(rule.pattern).test(path);
  } catch {
    return false;
  }
}

/** All rules of a group that match the given path, with applicability info. */
export function matchingRules(group: RoboGroup, path: string): RoboTxtRule[] {
  return group.rules.filter((r) => ruleMatchesPath(r, path));
}

export interface RuleVerdict {
  allow: boolean;
  /** The winning rule, or null when nothing matched (default = allow). */
  rule: RoboTxtRule | null;
}

/**
 * RFC 9309 / Google precedence over one group:
 *   - consider only rules whose pattern matches the path
 *   - the longest pattern wins; on equal length Allow beats Disallow
 *   - no match => allowed by default
 */
export function evaluateGroup(group: RoboGroup, path: string): RuleVerdict {
  const hits = group.rules.filter((r) => ruleMatchesPath(r, path));
  if (hits.length === 0) return { allow: true, rule: null };

  hits.sort((a, b) => {
    const byLen = b.pattern.length - a.pattern.length;
    if (byLen !== 0) return byLen;
    return a.kind === 'allow' ? -1 : b.kind === 'allow' ? 1 : 0;
  });
  const winner = hits[0];
  return { allow: winner.kind === 'allow', rule: winner };
}
