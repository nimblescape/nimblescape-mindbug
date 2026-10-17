// Builds the extension (Node, CommonJS) and the webview (browser) into dist/. A production build
// (--production, which vscode:prepublish passes) is minified and has no source maps.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  sourcemap: !production,
  minify: production,
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

mkdirSync('dist', { recursive: true });
// No map of an earlier development build may stay next to a minified bundle.
if (production) for (const file of ['dist/extension.js.map', 'dist/webview.js.map']) rmSync(file, { force: true });
const copyCss = () => copyFileSync('webview/style.css', 'dist/webview.css');

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((c) => c.watch()));
  copyCss();
} else {
  await Promise.all([extension, webview].map((b) => esbuild.build(b)));
  copyCss();
}
