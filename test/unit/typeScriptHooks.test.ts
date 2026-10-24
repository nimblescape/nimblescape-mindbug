// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as esbuild from 'esbuild';
import { nodeRunsHooks } from '../../src/runtime.ts';
import { compilerOptions, moduleFormat, type TypeScript, TYPESCRIPT_VARIABLE } from '../../src/typeScriptHooks.ts';

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

/**
 * The TypeScript compiler that VS Code ships, from the VS Code that `npm run test:vscode` downloads to .vscode-test/.
 * TypeScript 7, the TypeScript of node_modules/, has no typescript.js.
 */
function vscodeTypeScript(): string | undefined {
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

/** A program with an enum, a class with constructor parameter properties, and an import of another TypeScript file. */
const PROGRAM = `import { greet } from './greet.ts';
enum Size {
  Small,
  Large,
}
interface Named {
  name: string;
}
class Pizza implements Named {
  constructor(
    public name: string,
    private size: Size,
  ) {}
  isLarge(): boolean {
    return this.size === Size.Large;
  }
}
const pizza = new Pizza('Margherita', Size.Large);
console.log(greet(pizza.name), pizza.isLarge(), Size[1], typeof process.env.${TYPESCRIPT_VARIABLE});
`;

const GREET = `export function greet(name: string): string {
  return 'Hello ' + name;
}
`;

const typescript = vscodeTypeScript();

test.skipIf(!typescript || !nodeRunsHooks(process.version))('Node.js runs enums and parameter properties with the hooks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbug-hooks-'));
  try {
    // The hooks as the package has them (dist/typeScriptHooks.js, built by esbuild.mjs).
    const hooks = path.join(dir, 'typeScriptHooks.js');
    const env = { ...process.env, [TYPESCRIPT_VARIABLE]: typescript };
    esbuild.buildSync({ entryPoints: ['src/typeScriptHooks.ts'], outfile: hooks, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    // A folder without package.json, whose files with `import` or `export` are ES modules, a package with "type":
    // "module", a package with "type": "commonjs", and a project with a tsconfig.json that has "noEmit".
    const cases: [string, string | undefined][] = [
      ['plain', undefined],
      ['module', '{ "type": "module" }'],
      ['commonjs', '{ "type": "commonjs" }'],
    ];
    for (const [name, packageJson] of cases) {
      const folder = path.join(dir, name);
      fs.mkdirSync(folder);
      if (packageJson) fs.writeFileSync(path.join(folder, 'package.json'), packageJson);
      fs.writeFileSync(path.join(folder, 'tsconfig.json'), '{ "compilerOptions": { "noEmit": true, "allowImportingTsExtensions": true } }');
      fs.writeFileSync(path.join(folder, 'main.ts'), PROGRAM);
      fs.writeFileSync(path.join(folder, 'greet.ts'), GREET);
      const output = execFileSync(process.execPath, ['--require', hooks, path.join(folder, 'main.ts')], { env, encoding: 'utf8' });
      // The program does not see the variable of Mindbug.
      assert.equal(output, 'Hello Margherita true Large undefined\n', name);
    }
    // A syntax error stops the program with the file, the line and the message of TypeScript.
    const broken = path.join(dir, 'plain', 'broken.ts');
    fs.writeFileSync(broken, 'const a = 1;\nlet b = ;\n');
    assert.throws(
      () => execFileSync(process.execPath, ['--require', hooks, broken], { env, stdio: 'pipe' }),
      (e: { stderr: Buffer }) => e.stderr.toString().includes(`SyntaxError: ${broken}:2:9: Expression expected.`),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
