/**
 * Vitest setup — loaded once before the test files (vite.config.ts `test`).
 *
 * - `@testing-library/jest-dom/vitest` registers the DOM matchers
 *   (toBeInTheDocument, toHaveAttribute, …) on Vitest's expect AND augments its
 *   types, so no per-file import or tsconfig `types` entry is needed.
 * - Testing Library's automatic cleanup only self-registers when Vitest globals
 *   are enabled; we run with globals:false, so unmount between tests here.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
