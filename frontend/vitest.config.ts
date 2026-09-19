import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve the `@/*` path alias (from tsconfig) so tests can import route
// handlers and libs the same way the app does.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
  },
});
