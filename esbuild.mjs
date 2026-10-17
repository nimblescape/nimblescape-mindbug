// Builds the extension (Node, CommonJS) and the webview (browser) into dist/.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: true,
  target: 'es2022',
  logLevel: 'info',
};

const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
};

const webview = {
  ...common,
  entryPoints: ['webview/main.ts'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
};

// The VS Code integration suite (test/integration), built only with --tests.
const suite = {
  ...common,
  entryPoints: ['test/integration/suite.ts'],
  outfile: 'out/integration/suite.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
};

mkdirSync('dist', { recursive: true });
const copyCss = () => copyFileSync('webview/style.css', 'dist/webview.css');

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((c) => c.watch()));
  copyCss();
} else {
  const builds = [extension, webview];
  if (process.argv.includes('--tests')) builds.push(suite);
  await Promise.all(builds.map((b) => esbuild.build(b)));
  copyCss();
}
