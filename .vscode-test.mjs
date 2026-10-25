// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The tests in a real VS Code (npm run test:vscode): @vscode/test-cli downloads VS Code to .vscode-test/, starts it
// with the extension of the development build in dist/ and the folder examples/, and runs the bundled tests of
// out/test/vscode/ (scripts/build-vscode-tests.mjs) with mocha in its extension host. The tests debug the examples with
// the debug type "ts" of the extension nimblescape TypeScript, the extension dependency of Mindbug: test-cli installs
// the pinned release of TS_EXTENSION from the Marketplace, or the VSIX file that MINDBUG_TS_VSIX names (for a test
// before that release). Its command ts runs the programs with the Node.js of the PATH (22 or newer).
// VSCODE_TEST_VERSION selects the VS Code version: "stable" (the default), "insiders" or a version such as 1.125.0. On
// Linux without a display, run it under xvfb-run.
import { defineConfig } from '@vscode/test-cli';

/** The release of nimblescape TypeScript that the tests use, instead of the newest one of the Marketplace. */
const TS_EXTENSION = 'nimblescape.nimblescape-typescript@0.2.0';

export default defineConfig([
  {
    label: 'vscode',
    files: 'out/test/vscode/*.test.js',
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    workspaceFolder: './examples',
    // test-cli installs the extension dependency itself, unpinned; the tests install the pinned release instead.
    skipExtensionDependencies: true,
    installExtensions: [process.env.MINDBUG_TS_VSIX || TS_EXTENSION],
    // No --disable-extensions: it would also turn off nimblescape TypeScript, and Mindbug then does not start. The
    // folder of the extensions of the tests (.vscode-test/extensions/) has no other extension.
    launchArgs: ['--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    mocha: {
      ui: 'bdd',
      // Each test starts a program with ts and steps through it; the first start of VS Code can be slow on CI
      // runners.
      timeout: 120_000,
    },
  },
]);
