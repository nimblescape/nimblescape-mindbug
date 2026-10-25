// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { defineConfig } from 'vitest/config';

// Unit tests (npm test), and the test of the release check. They need no VS Code.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
