// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { compilerOptions, moduleFormat, packageJsonOf, type TypeScript } from '../node/typeScriptHooks.ts';

test('the format of a TypeScript file, as Node.js decides it', () => {
  const never = () => assert.fail('the syntax decides only without "type"');
  assert.equal(moduleFormat('/a/main.mts', 'commonjs', never), 'esm');
  assert.equal(moduleFormat('/a/main.cts', 'module', never), 'cjs');
  assert.equal(moduleFormat('/a/main.ts', 'module', never), 'esm');
  assert.equal(moduleFormat('/a/main.ts', 'commonjs', never), 'cjs');
  // Without "type": an ES module with `import` or `export`, else a CommonJS module.
  assert.equal(moduleFormat('/a/main.ts', undefined, () => true), 'esm');
  assert.equal(moduleFormat('/a/main.ts', undefined, () => false), 'cjs');
});

test('the package.json of a file, as Node.js finds it', () => {
  const files = (...list: string[]) => (file: string) => list.map((f) => path.resolve(f)).includes(file);
  const main = path.resolve('/course/20-assignments/01/main.ts');
  // The first package.json in the folder of the file or above it.
  const own = path.resolve('/course/20-assignments/01/package.json');
  assert.equal(packageJsonOf(main, files(own, '/course/package.json')), own);
  assert.equal(packageJsonOf(main, files('/course/package.json')), path.resolve('/course/package.json'));
  assert.equal(packageJsonOf(main, files()), undefined);
  // The search ends at a folder named node_modules.
  const inPackage = path.resolve('/course/node_modules/lib/index.ts');
  assert.equal(packageJsonOf(inPackage, files('/course/node_modules/package.json', '/course/package.json')), undefined);
});

test('the options of the project, with the changes that a run in memory needs', () => {
  const ts = { ModuleKind: { CommonJS: 1, ESNext: 99 } } as unknown as TypeScript;
  // The options of the tsconfig.json of a course: Node.js modules, no output, imports with the extension .ts.
  const project = { strict: true, module: 199, moduleResolution: 99, noEmit: true, verbatimModuleSyntax: true, target: 12 };
  const options = compilerOptions(ts, { ...project, outDir: 'dist', sourceMap: true, rewriteRelativeImportExtensions: true }, 'esm');
  assert.equal(options.module, 99);
  assert.equal(compilerOptions(ts, project, 'cjs').module, 1);
  assert.equal(options.moduleResolution, undefined);
  assert.equal(options.noEmit, false);
  assert.equal(options.inlineSourceMap, true);
  assert.equal(options.inlineSources, true);
  assert.equal(options.sourceMap, false);
  assert.equal(options.outDir, undefined);
  assert.equal(options.rewriteRelativeImportExtensions, false);
  // The other options of the project stay.
  assert.equal(options.strict, true);
  assert.equal(options.verbatimModuleSyntax, true);
  assert.equal(options.target, 12);
});
