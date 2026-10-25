// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  debugConfiguration,
  findNode,
  nodeRunsTypeScript,
  nodeTypeScript,
  typeScriptCompiler,
  TYPESCRIPT_VARIABLE,
  type LaunchSettings,
} from '../../src/runtime.ts';
import { TYPESCRIPT_VARIABLE as HOOKS_VARIABLE } from '../../src/typeScriptHooks.ts';

const settings: LaunchSettings = { nodePath: 'node', port: 9229, stopOnEntry: true };

test('Mindbug starts Node.js 24 and newer', () => {
  for (const version of ['v24.0.0', 'v24.22.0', '25.9.0', 'v26.12.1', 'v27.1.0']) assert.ok(nodeRunsTypeScript(version), version);
  for (const version of ['v23.11.1', 'v22.22.0', 'v22.7.0', 'v20.19.1', 'deno 2.9.7']) assert.ok(!nodeRunsTypeScript(version), version);
});

test('Mindbug takes the Node.js of the settings when it is Node.js 24 or newer', async () => {
  const versions = (found: Record<string, string>) => async (program: string) => found[program];
  assert.deepEqual(await findNode(settings, versions({ node: 'v26.1.0' })), { version: 'v26.1.0' });
  assert.deepEqual(await findNode({ ...settings, nodePath: '/opt/node' }, versions({ '/opt/node': 'v24.0.0' })), { version: 'v24.0.0' });
  const old = await findNode(settings, versions({ node: 'v22.22.0' }));
  assert.ok('problem' in old && old.problem.includes('Node.js 24 or newer'), 'Mindbug names the version it needs');
  assert.ok('problem' in old && old.problem.includes('Node.js v22.22.0'), 'Mindbug does not start Node.js 22');
  const none = await findNode({ ...settings, nodePath: '/opt/node' }, versions({}));
  assert.ok('problem' in none && none.problem.includes('did not find "/opt/node"'));
});

test('Node.js runs TypeScript with the hooks and the compiler of VS Code, else it only strips the types', () => {
  const typescript = path.resolve('/vscode/extensions/node_modules/typescript/lib/typescript.js');
  const hooks = path.resolve('/ext/dist/typeScriptHooks.js');
  assert.equal(TYPESCRIPT_VARIABLE, HOOKS_VARIABLE, 'the hooks read the variable that Mindbug sets');
  assert.deepEqual(nodeTypeScript(typescript, hooks), { args: ['--require', hooks], env: { [TYPESCRIPT_VARIABLE]: typescript } });
  // No experimental option of Node.js.
  assert.deepEqual(nodeTypeScript(undefined, hooks), { args: [], env: {} });
});

test('the TypeScript compiler of VS Code: the setting js/ts.tsdk.path, then typescript.tsdk, then the TypeScript of VS Code', () => {
  const root = path.resolve('/course');
  const appRoot = path.resolve('/vscode/resources/app');
  const shipped = path.join(appRoot, 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js');
  const course = path.join(root, 'node_modules', 'typescript', 'lib', 'typescript.js');
  const files = (...list: string[]) => (file: string) => list.includes(file);
  // A relative folder is relative to a workspace folder.
  assert.equal(typeScriptCompiler(['node_modules/typescript/lib', undefined], [root], appRoot, files(course, shipped)), course);
  assert.equal(typeScriptCompiler([undefined, 'node_modules/typescript/lib'], [root], appRoot, files(course, shipped)), course);
  const other = path.resolve('/opt/ts/lib');
  assert.equal(
    typeScriptCompiler([other, 'node_modules/typescript/lib'], [root], appRoot, files(course, path.join(other, 'typescript.js'))),
    path.join(other, 'typescript.js'),
  );
  // The first workspace folder that has the folder of the setting.
  const second = path.resolve('/second');
  const inSecond = path.join(second, 'node_modules', 'typescript', 'lib', 'typescript.js');
  assert.equal(typeScriptCompiler(['node_modules/typescript/lib'], [root, second], appRoot, files(inSecond, shipped)), inSecond);
  // No setting, or a folder without typescript.js (TypeScript 7): the TypeScript of VS Code.
  assert.equal(typeScriptCompiler([undefined, ''], [root], appRoot, files(course, shipped)), shipped);
  assert.equal(typeScriptCompiler(['node_modules/typescript/lib'], [root], appRoot, files(shipped)), shipped);
  assert.equal(typeScriptCompiler([], [], appRoot, files()), undefined);
});

test('the debug configuration: Node.js waits for the debugger on the port', () => {
  const plain = debugConfiguration('/w/a.ts', '/w', settings);
  assert.equal(plain.type, 'pwa-node');
  assert.equal(plain.runtimeExecutable, 'node');
  assert.deepEqual(plain.runtimeArgs, ['--inspect-brk=127.0.0.1:9229']);
  assert.equal(plain.attachSimplePort, 9229);
  // Without environment variables, the configuration has none.
  assert.equal(plain.env, undefined);
  const typescript = '/vscode/extensions/node_modules/typescript/lib/typescript.js';
  const typeScript = { args: ['--require', '/ext/dist/typeScriptHooks.js'], env: { [TYPESCRIPT_VARIABLE]: typescript } };
  const node = debugConfiguration('/w/a.ts', '/w', { ...settings, stopOnEntry: false, nodePath: '/opt/node' }, typeScript);
  assert.equal(node.runtimeExecutable, '/opt/node');
  assert.deepEqual(node.runtimeArgs, ['--inspect-wait=127.0.0.1:9229', ...typeScript.args]);
  assert.deepEqual(node.env, typeScript.env);
  assert.equal(node.program, '/w/a.ts');
});

test('the debug configuration skips the code of Node.js', () => {
  assert.deepEqual(debugConfiguration('/w/a.ts', '/w', settings).skipFiles, ['<node_internals>/**']);
});
