// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// How the tests run a TypeScript program with Node.js: as Mindbug runs it (nodeTypeScript in src/runtime.ts), with the
// hooks of src/typeScriptHooks.ts and the TypeScript compiler of the VS Code that `npm run test:vscode` downloads to
// .vscode-test/. TypeScript 7, the TypeScript of node_modules/, has no typescript.js.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { nodeRunsTypeScript, nodeTypeScript, type NodeTypeScript } from '../../src/runtime.ts';

/** The TypeScript compiler that VS Code ships, from the VS Code in .vscode-test/, or undefined. */
export function vscodeTypeScript(): string | undefined {
  const folder = path.resolve('.vscode-test');
  if (!fs.existsSync(folder)) return undefined;
  for (const name of fs.readdirSync(folder)) {
    const apps = [path.join(folder, name, 'resources', 'app'), path.join(folder, name, 'Visual Studio Code.app', 'Contents', 'Resources', 'app')];
    for (const app of apps) {
      const file = path.join(app, 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js');
      if (fs.existsSync(file)) return file;
    }
  }
  return undefined;
}

let hooks: string | undefined;

/** The hooks as the package has them (dist/typeScriptHooks.js, built by esbuild.mjs), in a new temporary folder. */
export function hooksFile(): string {
  if (!hooks) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbug-hooks-'));
    hooks = path.join(dir, 'typeScriptHooks.js');
    esbuild.buildSync({ entryPoints: ['src/typeScriptHooks.ts'], outfile: hooks, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  }
  return hooks;
}

/** The options and the environment variables with which Mindbug runs a TypeScript file in this Node.js. */
export function mindbugNode(): NodeTypeScript {
  return nodeTypeScript(vscodeTypeScript(), hooksFile());
}

/** True when this Node.js runs all of TypeScript as Mindbug runs it: Node.js 24 or newer, with the hooks and a compiler. */
export function runsAllOfTypeScript(): boolean {
  return nodeRunsTypeScript(process.version) && vscodeTypeScript() !== undefined;
}
