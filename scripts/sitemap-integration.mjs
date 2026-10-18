/**
 * Astro integration — generates /sitemap.xml from the pages this build
 * actually emitted into the output directory.
 *
 * Why a local integration instead of @astrojs/sitemap:
 *  - The official integration emits sitemap-index.xml + sitemap-0.xml, while
 *    robots.txt and the site's existing references point at /sitemap.xml.
 *  - It builds the URL list from route definitions, not the generated HTML, so
 *    it cannot drop pages that render <meta name="robots" content="noindex">.
 *  - Reading dist/ means URLs always reflect real, built pages: new pages are
 *    picked up automatically and deleted pages disappear on the next build.
 *  - No extra dependency or lockfile change is needed.
 *
 * Lastmod is intentionally omitted: this project has no reliable per-page
 * substantive-update timestamp (file mtimes are just build artifacts), and a
 * wrong lastmod is worse than none.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ORIGIN = 'https://www.aigeokit.com';

/** Recursively collect every pre-rendered index.html in the output directory. */
async function findIndexPages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const pages = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await findIndexPages(fullPath)));
    } else if (entry.isFile() && entry.name === 'index.html') {
      pages.push(fullPath);
    }
  }

  return pages;
}

/** True when the built page opts out of indexing via <meta name="robots">. */
function isNoindex(html) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = tag.match(/\bname\s*=\s*["']([^"']*)["']/i)?.[1]?.trim().toLowerCase();
    if (name !== 'robots') continue;

    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (/(?:^|[\s,;])noindex(?:[\s,;]|$)/i.test(content)) return true;
  }

  return false;
}

/** True for client-side redirect stubs (meta refresh), which must not be listed. */
function isRedirect(html) {
  return /<meta\b[^>]*http-equiv\s*=\s*["']refresh["']/i.test(html);
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** /tools/index.html -> /tools/ ; index.html -> / */
function routeFromFile(outDir, file) {
  const relativeDir = path.relative(outDir, path.dirname(file));
  if (relativeDir === '') return '/';
  return '/' + relativeDir.split(path.sep).join('/') + '/';
}

export default function sitemapIntegration() {
  return {
    name: 'aigeokit-sitemap',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const urls = new Set();

        for (const file of await findIndexPages(outDir)) {
          const html = await readFile(file, 'utf8');
          if (isNoindex(html) || isRedirect(html)) continue;
          urls.add(SITE_ORIGIN + routeFromFile(outDir, file));
        }

        const sorted = [...urls].sort();
        const entries = sorted
          .map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`)
          .join('\n');
        const xml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          entries,
          '</urlset>',
          '',
        ].join('\n');

        await writeFile(path.join(outDir, 'sitemap.xml'), xml, 'utf8');
        logger.info(`sitemap.xml generated with ${sorted.length} URL(s)`);
      },
    },
  };
}
