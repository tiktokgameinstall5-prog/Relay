import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Content sources are declared in src/index.css with @source, which is how
  // Tailwind 4 does it — the Vite plugin itself takes no content option.
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Why a proxy rather than CORS on the API: the browser only ever sees
      // one origin (localhost:5173), so no preflight, no Access-Control-*
      // headers, and no `enableCors()` in apps/api/src/main.ts to get wrong.
      // The API keeps its global 'api' prefix, so the path passes through
      // unrewritten.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
