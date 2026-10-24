// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The tests in a real VS Code (npm run test:vscode): @vscode/test-cli downloads VS Code to .vscode-test/, starts it
// with the extension of the development build in dist/ and the folder examples/, and runs the bundled tests of
// out/test/vscode/ (scripts/build-vscode-tests.mjs) with mocha in its extension host. The tests debug the examples
// with Deno and with Node.js, so Deno and Node.js 22.18 or newer must be on the PATH: Node.js runs them with the hooks
// of Mindbug and the TypeScript compiler of the downloaded VS Code. VSCODE_TEST_VERSION selects the VS Code version:
// "stable" (the default), "insiders" or a version such as 1.125.0. On Linux without a display, run it under xvfb-run.
import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
  {
    label: 'vscode',
    files: 'out/test/vscode/*.test.js',
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    workspaceFolder: './examples',
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    mocha: {
      ui: 'bdd',
      // Each test starts Deno or Node.js and steps through a program; the first start of VS Code can be slow on CI
      // runners.
      timeout: 120_000,
    },
  },
]);
