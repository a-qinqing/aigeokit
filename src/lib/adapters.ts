import type { PlatformId, SchemaObject } from './types';

/**
 * Platform adapters — the same schema object, rendered for three targets.
 *
 * - raw:       plain pretty-printed JSON
 * - wordpress: <script type="application/ld+json">…</script> with HTML-safe
 *              escapes (< > & → \uXXXX) so the JSON can never break out of
 *              the script tag, even with user-supplied content.
 * - shopify:   Liquid `assign` + output tag. JSON is compacted to one line
 *              (Liquid string literals are single-line), backslashes and
 *              single quotes are escaped, and `</script` is neutralized.
 */

/** JSON.stringify emits line-separator chars (U+2028/U+2029) raw since ES2019;
 *  both break inline <script> blocks in some browsers — normalize them. */
const escapeLineSeparators = (json: string): string => {
  let out = '';
  for (const ch of json) {
    const code = ch.charCodeAt(0);
    out += code === 0x2028 ? '\\u2028' : code === 0x2029 ? '\\u2029' : ch;
  }
  return out;
};

/** HTML-escape a JSON string so it is safe inside an inline <script> tag. */
export const escapeInlineScript = (json: string): string =>
  escapeLineSeparators(
    json
      .replace(/&/g, '\\u0026')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e'),
  );

export function toRaw(obj: SchemaObject): string {
  return JSON.stringify(obj, null, 2);
}

export function toWordPress(obj: SchemaObject): string {
  const json = escapeInlineScript(JSON.stringify(obj, null, 2));
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

export function toShopify(obj: SchemaObject): string {
  const escaped = JSON.stringify(obj)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/<\/script/gi, '<\\/script');

  return [
    '{%- comment -%}',
    '  AIGEOKit · JSON-LD schema — paste into a Shopify snippet or theme.liquid',
    '{%- endcomment -%}',
    `{%- assign geo_schema = '${escaped}' -%}`,
    '<script type="application/ld+json">',
    '{{ geo_schema }}',
    '</script>',
  ].join('\n');
}

export const ADAPTERS: Record<PlatformId, (obj: SchemaObject) => string> = {
  raw: toRaw,
  wordpress: toWordPress,
  shopify: toShopify,
};

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  raw: 'Raw JSON-LD',
  wordpress: 'WordPress (Header Code)',
  shopify: 'Shopify (Liquid Theme)',
};
