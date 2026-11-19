import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // The browser talks to the world server through the dev server, so it needs one address only.
    proxy: {
      '/world': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
