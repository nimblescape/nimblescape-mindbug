// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The hooks of the tests (typeScriptHooks.ts) in Node.js, with the TypeScript compiler of the VS Code in
// .vscode-test/ (typeScript.ts). Without it, or in a Node.js without synchronous module hooks, the test is skipped.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TYPESCRIPT_VARIABLE } from './typeScriptHooks.ts';
import { hooksFile, nodeHasHooks, vscodeTypeScript } from './typeScript.ts';

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
const hooks = hooksFile();

test.skipIf(!typescript || !nodeHasHooks(process.version))('Node.js runs enums and parameter properties with the hooks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindbug-hooks-'));
  try {
    const env = { ...process.env, [TYPESCRIPT_VARIABLE]: typescript };
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
