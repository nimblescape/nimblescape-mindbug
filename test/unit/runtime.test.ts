// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  chooseRuntime,
  debugConfiguration,
  isDenoProject,
  nodeRunsTypeScript,
  nodeTypeScript,
  typeScriptCompiler,
  TYPESCRIPT_VARIABLE,
  type LaunchSettings,
} from '../../src/runtime.ts';
import { TYPESCRIPT_VARIABLE as HOOKS_VARIABLE } from '../../src/typeScriptHooks.ts';

const settings: LaunchSettings = { runtime: 'auto', denoPath: 'deno', nodePath: 'node', port: 9229, stopOnEntry: true };

test('Mindbug starts Node.js 24 and newer', () => {
  for (const version of ['v24.0.0', 'v24.22.0', '25.9.0', 'v26.12.1', 'v27.1.0']) assert.ok(nodeRunsTypeScript(version), version);
  for (const version of ['v23.11.1', 'v22.22.0', 'v22.7.0', 'v20.19.1', 'deno 2.9.7']) assert.ok(!nodeRunsTypeScript(version), version);
});

test('"auto" takes Node.js when it runs TypeScript, else Deno', async () => {
  const versions = (found: Record<string, string>) => async (program: string) => found[program];
  assert.deepEqual(await chooseRuntime(settings, false, versions({ deno: 'deno 2.9.7', node: 'v26.1.0' })), {
    runtime: 'node',
    version: 'v26.1.0',
  });
  assert.deepEqual(await chooseRuntime(settings, false, versions({ deno: 'deno 2.9.7', node: 'v22.22.0' })), { runtime: 'deno' });
  assert.deepEqual(await chooseRuntime(settings, false, versions({ deno: 'deno 2.9.7' })), { runtime: 'deno' });
  const old = await chooseRuntime(settings, false, versions({ node: 'v22.22.0' }));
  assert.ok('problem' in old && old.problem.includes('Node.js 24 or newer'), 'Mindbug names the version it needs');
  assert.ok('problem' in old && old.problem.includes('Node.js v22.22.0'), 'Mindbug does not start Node.js 22');
  const none = await chooseRuntime(settings, false, versions({}));
  assert.ok('problem' in none && none.problem.includes('found neither'));
});

test('"auto" takes Deno first for a Deno project', async () => {
  const versions = (found: Record<string, string>) => async (program: string) => found[program];
  assert.deepEqual(await chooseRuntime(settings, true, versions({ deno: 'deno 2.9.7', node: 'v26.1.0' })), { runtime: 'deno' });
  assert.deepEqual(await chooseRuntime(settings, true, versions({ node: 'v26.1.0' })), { runtime: 'node', version: 'v26.1.0' });
});

test('a runtime that is set must run', async () => {
  const versions = (found: Record<string, string>) => async (program: string) => found[program];
  const node = { ...settings, runtime: 'node' as const };
  assert.deepEqual(await chooseRuntime(node, true, versions({ deno: 'deno 2.9.7', node: 'v24.0.0' })), {
    runtime: 'node',
    version: 'v24.0.0',
  });
  const deno = { ...settings, runtime: 'deno' as const };
  assert.deepEqual(await chooseRuntime(deno, false, versions({ deno: 'deno 2.9.7', node: 'v26.1.0' })), { runtime: 'deno' });
  const noDeno = await chooseRuntime(deno, false, versions({ node: 'v24.20.0' }));
  assert.ok('problem' in noDeno && noDeno.problem.includes('did not find Deno'));
  const noNode = await chooseRuntime({ ...node, nodePath: '/opt/node' }, false, versions({ deno: 'deno 2.9.7' }));
  assert.ok('problem' in noNode && noNode.problem.includes('did not find "/opt/node"'));
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

test('a Deno project: a folder with deno.json or deno.jsonc, or a folder above it', () => {
  const root = path.resolve('/course');
  const files = (...list: string[]) => (file: string) => list.map((f) => path.join(root, f)).includes(file);
  for (const config of ['deno.json', 'deno.jsonc']) {
    assert.ok(isDenoProject(path.join(root, 'old', 'src'), files(`old/${config}`)));
    assert.ok(isDenoProject(path.join(root, 'old'), files(`old/${config}`)));
  }
  assert.ok(!isDenoProject(path.join(root, 'src'), files('package.json', 'old/deno.json')));
});

test('the debug configuration: the runtime waits for the debugger on the port, for Deno and Node.js', () => {
  const deno = debugConfiguration('/w/a.ts', '/w', 'deno', settings);
  assert.equal(deno.type, 'pwa-node');
  assert.equal(deno.runtimeExecutable, 'deno');
  assert.deepEqual(deno.runtimeArgs, ['run', '--inspect-brk=127.0.0.1:9229', '--allow-all']);
  assert.equal(deno.attachSimplePort, 9229);
  assert.equal(deno.env, undefined);
  const typescript = '/vscode/extensions/node_modules/typescript/lib/typescript.js';
  const typeScript = { args: ['--require', '/ext/dist/typeScriptHooks.js'], env: { [TYPESCRIPT_VARIABLE]: typescript } };
  const node = debugConfiguration('/w/a.ts', '/w', 'node', { ...settings, stopOnEntry: false, nodePath: '/opt/node' }, typeScript);
  assert.equal(node.runtimeExecutable, '/opt/node');
  assert.deepEqual(node.runtimeArgs, ['--inspect-wait=127.0.0.1:9229', ...typeScript.args]);
  assert.deepEqual(node.env, typeScript.env);
  assert.equal(node.program, '/w/a.ts');
  // Without environment variables, the configuration has none.
  assert.equal(debugConfiguration('/w/a.ts', '/w', 'node', settings, { args: [], env: {} }).env, undefined);
});

test('the debug configuration skips the code of Node.js and of Deno', () => {
  for (const runtime of ['deno', 'node'] as const) {
    assert.deepEqual(debugConfiguration('/w/a.ts', '/w', runtime, settings).skipFiles, ['<node_internals>/**', 'ext:*/**']);
  }
});
