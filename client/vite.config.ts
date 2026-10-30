import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

/**
 * Link previews (og:image / og:url) need absolute URLs: VITE_SITE_URL if set, else Vercel's
 * production domain (a system env var at build time), else relative paths (local dev).
 */
const siteUrl = (
  process.env.VITE_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
).replace(/\/+$/, '');

const siteUrlPlugin: Plugin = {
  name: 'site-url',
  transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl),
};

export default defineConfig({
  plugins: [siteUrlPlugin],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      // Two pages: the game and the map editor (/editor on Vercel via cleanUrls).
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        editor: resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },
});
