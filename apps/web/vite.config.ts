/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
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
  // Vitest — jsdom, because these are component tests (setup in src/test/setup.ts).
  // css:false because jsdom applies no styles anyway: skip the Tailwind pipeline
  // so a stray stylesheet import can never slow a unit test. What jsdom can and
  // cannot prove about the responsive nav is spelled out in AppShell.test.tsx.
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Windows + npm workspace: the default `forks` pool times out waiting for
    // the child worker to hand-shake. Worker threads start reliably here.
    pool: 'threads',
  },
});
