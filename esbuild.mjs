// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Builds the extension (Node.js, CommonJS), the hooks with which Node.js runs TypeScript (src/typeScriptHooks.ts;
// Node.js, CommonJS, which Node.js loads with --require) and the webview (browser) into dist/. VS Code provides the
// module `vscode` at run time, so the bundle of the extension leaves it out. The bundles are readable JavaScript: not
// minified, so that they keep the names of the source and anyone can read the code of the package and compare it with
// the source (CONTRIBUTING.md, "Reviewing the package"). The option `keepNames` stays off: it adds calls of a helper of
// esbuild into every function, also into installHeapWalker of src/heapWalker.ts, whose text runs in the debugged
// program, where that helper does not exist. Only a development build writes source maps; a production build
// (--production, which vscode:prepublish passes) has none.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: false,
  logLevel: 'info',
};

const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['vscode'],
};

const hooks = {
  ...common,
  entryPoints: ['src/typeScriptHooks.ts'],
  outfile: 'dist/typeScriptHooks.js',
  platform: 'node',
  format: 'cjs',
  target: 'node24',
};

const webview = {
  ...common,
  entryPoints: ['webview/main.ts'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
};

mkdirSync('dist', { recursive: true });
// No map of an earlier development build may stay next to a minified bundle.
if (production) {
  for (const file of ['dist/extension.js.map', 'dist/typeScriptHooks.js.map', 'dist/webview.js.map']) rmSync(file, { force: true });
}
const copyCss = () => copyFileSync('webview/style.css', 'dist/webview.css');

if (watch) {
  const contexts = await Promise.all([extension, hooks, webview].map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  copyCss();
} else {
  await Promise.all([extension, hooks, webview].map((b) => esbuild.build(b)));
  copyCss();
}
