# AIGEOKit

Free, privacy-first **GEO (Generative Engine Optimization) toolkit** for webmasters and SEOs — built to get your pages cited by **SearchGPT, Perplexity and AI Overviews**.

The site follows a clean three-layer URL structure: **homepage** (brand + featured tool + long-form GEO guide) → **`/tools/`** (tools directory with FAQ) → **`/tools/schema-generator/`** (the live tool). The generator produces production-ready JSON-LD for 8 schema types and scores it against a GEO Readiness Checklist that measures how likely AI assistants are to find, trust and quote your entities.

## ✨ Features

| Feature | Details |
| --- | --- |
| ⚡ 8 schema generators | Article/BlogPosting, FAQ, Product, Organization, Person, LocalBusiness, Breadcrumbs, How-To |
| 🧭 GEO Readiness Checklist | Live checks for `sameAs` cross-linking, `citation`, `publisher/author` entity graphs, dates, images, canonical URLs — each with an actionable fix |
| 🔀 Platform adapters | Tab switching between **Raw JSON**, **WordPress (Script Tag)** and **Shopify (Liquid Tag)** with proper entity escaping (`</script>`, quotes, Liquid string literals) |
| 🪟 Affiliate modal | "Copy JSON-LD" opens a sleek modal with platform-specific recommendations (WPCode for WordPress, theme.liquid for Shopify, Schema.org validator) |
| 🛡 100% client-side | All generation and validation runs in the browser — no API calls, no databases, no tracking |

## 🚀 Tech stack

- **Astro** (SSG, `output: 'static'`) — zero server overhead
- **Tailwind CSS v4** (via `@tailwindcss/vite`)
- **Vanilla TypeScript** for all client logic (`src/lib/`)
- **Cloudflare Pages** as the deployment target

## 🗂 Project structure

```text
/
├── public/                  # favicon etc.
├── src/
│   ├── components/          # Header, Hero, ToolGrid (portal), SchemaPicker, SchemaBuilder, CodeOutput, GeoChecklist, CopyModal, SEOGuide, Footer
│   ├── layouts/             # Layout.astro (SEO/OG/Twitter meta + optional JSON-LD per page)
│   ├── lib/                 # ★ all pure-frontend logic (used by /tools/schema-generator/)
│   │   ├── types.ts         # shared types
│   │   ├── tools.ts         # tool matrix: form field definitions + examples
│   │   ├── generators.ts    # JSON-LD builders (pure functions)
│   │   ├── adapters.ts      # Raw / WordPress / Shopify output with escaping
│   │   ├── geoChecklist.ts  # GEO Readiness Checklist engine
│   │   └── app.ts           # client-side controller
│   ├── pages/
│   │   ├── index.astro                     # brand homepage: featured tool + GEO guide
│   │   └── tools/
│   │       ├── index.astro                 # /tools/ directory (portal + FAQ)
│   │       └── schema-generator.astro      # JSON-LD Schema Generator & GEO Checklist
│   └── styles/global.css    # Tailwind v4 theme
├── wrangler.toml            # Cloudflare Pages config
└── package.json
```

## 🧞 Commands

| Command | Action |
| :--- | :--- |
| `npm install` | Install dependencies |
| `npm run dev` | Start dev server at `localhost:4321` |
| `npm run build` | Build the production site to `./dist/` |
| `npm run preview` | Preview the build locally |
| `npm run astro check` | Type-check the project |

## ☁️ Deploy to Cloudflare Pages

**Via the dashboard (recommended):**

1. Push this repo to GitHub
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
3. Framework preset: **Astro** · Build command: `npm run build` · Output directory: `dist`

**Via Wrangler CLI:**

```sh
npm i -D wrangler
npx wrangler pages deploy dist
```

The `wrangler.toml` already points at `dist`. The result is a pure static site — no Workers runtime needed, edge-cached by default.

## 🪙 Affiliate links

The copy modal's recommendation card uses placeholder affiliate URLs (`https://example.com/aff-wpcode`, `https://example.com/aff-semrush`) — search for `rel="noopener sponsored"` in `src/lib/app.ts` and swap in your own affiliate links before going live.
