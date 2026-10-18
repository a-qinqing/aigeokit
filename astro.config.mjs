// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemapIntegration from './scripts/sitemap-integration.mjs';

// https://astro.build/config
// SSG mode (output: 'static') — zero server overhead, perfect for Cloudflare Pages.
export default defineConfig({
  output: 'static',
  integrations: [sitemapIntegration()],
  vite: {
    plugins: [tailwindcss()],
  },
});
