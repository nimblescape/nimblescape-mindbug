// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// How the tests run a TypeScript program with Node.js: with the hooks of typeScriptHooks.ts and the TypeScript compiler
// of the VS Code that `npm run test:vscode` downloads to .vscode-test/, the compiler that the command ts takes inside
// VS Code. TypeScript 7, the TypeScript of node_modules/, has no typescript.js.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { TYPESCRIPT_VARIABLE } from './typeScriptHooks.ts';

/** How Node.js runs a TypeScript file: its options, and the environment variables of the program. */
export interface NodeTypeScript {
  args: string[];
  env: Record<string, string>;
}

/** The oldest major version of Node.js with module.registerHooks and type stripping without an option. */
const MIN_NODE = 24;

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

/** The hooks, bundled as one CommonJS file for `--require`, in a new temporary folder. */
export function hooksFile(): string {
  if (!hooks) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbug-hooks-'));
    hooks = path.join(dir, 'typeScriptHooks.js');
    esbuild.buildSync({ entryPoints: ['test/node/typeScriptHooks.ts'], outfile: hooks, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  }
  return hooks;
}

/** The options and the environment variables with which the tests run a TypeScript file in this Node.js. */
export function nodeWithTypeScript(): NodeTypeScript {
  const typescript = vscodeTypeScript();
  return typescript ? { args: ['--require', hooksFile()], env: { [TYPESCRIPT_VARIABLE]: typescript } } : { args: [], env: {} };
}

/** True for a Node.js version (such as "v24.1.0") with the synchronous module hooks: MIN_NODE or newer. */
export function nodeHasHooks(version: string): boolean {
  const m = /^v?(\d+)\.\d+/.exec(version.trim());
  return m !== null && Number(m[1]) >= MIN_NODE;
}

/** True when this Node.js runs all of TypeScript: Node.js 24 or newer, with the hooks and a compiler. */
export function runsAllOfTypeScript(): boolean {
  return nodeHasHooks(process.version) && vscodeTypeScript() !== undefined;
}
