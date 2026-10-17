// Starts a real VS Code with the extension and runs the integration suite in it.
// It downloads VS Code the first time (into .vscode-test/). It needs Deno on the PATH.
// On Linux without a display, run it with xvfb-run.
//
//   npm run test:vscode

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

await runTests({
  version: process.env.VSCODE_VERSION ?? 'stable',
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, 'out', 'integration', 'suite.js'),
  launchArgs: [join(root, 'examples'), '--disable-extensions', '--disable-workspace-trust'],
});
