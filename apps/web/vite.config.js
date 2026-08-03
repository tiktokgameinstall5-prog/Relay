import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

export default defineConfig({
  // Content sources are declared in src/index.css with @source, which is how
  // Tailwind 4 does it — the Vite plugin itself takes no content option.
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The prototype stays at the repo root, where CLAUDE.md points at it as
      // the UI reference. Aliasing rather than copying means there is exactly
      // one copy — a duplicate under src/ would drift from the reference the
      // first time either one is edited.
      '@prototype': resolve(repoRoot, 'workspace-relay-prototype.jsx'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      // Required because the prototype lives above this package's root.
      allow: [repoRoot],
    },
  },
});
