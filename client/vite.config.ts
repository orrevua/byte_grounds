import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
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
