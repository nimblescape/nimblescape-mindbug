// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { defineConfig } from 'vitest/config';

// Tests against a real Node.js program (npm run test:node). `npm test` does not run them.
export default defineConfig({
  test: {
    include: ['test/node/**/*.test.ts'],
    environment: 'node',
    // Each test starts Node.js and steps through a program.
    testTimeout: 60_000,
    reporters: ['verbose'],
  },
});
