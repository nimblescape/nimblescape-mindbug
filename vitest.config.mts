import { defineConfig } from 'vitest/config';

// Unit tests (npm test). They need no Deno and no VS Code.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
