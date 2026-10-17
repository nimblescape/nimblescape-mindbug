import { defineConfig } from 'vitest/config';

// Tests against a real Deno program (npm run test:deno). `npm test` does not run them.
export default defineConfig({
  test: {
    include: ['test/deno/**/*.test.ts'],
    environment: 'node',
    // Each test starts Deno and steps through a program.
    testTimeout: 60_000,
    reporters: ['verbose'],
  },
});
