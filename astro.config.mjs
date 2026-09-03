// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// SSG mode (output: 'static') — zero server overhead, perfect for Cloudflare Pages.
export default defineConfig({
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
