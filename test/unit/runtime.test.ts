// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { chooseRuntime, debugConfiguration, nodeRunsTypeScript, type LaunchSettings } from '../../src/runtime.ts';

const settings: LaunchSettings = { runtime: 'auto', denoPath: 'deno', nodePath: 'node', port: 9229, stopOnEntry: true };

test('Node.js runs TypeScript files from version 22.7 on', () => {
  assert.ok(nodeRunsTypeScript('v24.20.0'));
  assert.ok(nodeRunsTypeScript('v22.7.0'));
  assert.ok(nodeRunsTypeScript('23.0.0'));
  assert.ok(!nodeRunsTypeScript('v22.6.0'));
  assert.ok(!nodeRunsTypeScript('v20.19.1'));
  assert.ok(!nodeRunsTypeScript('deno 2.9.7'));
});

test('"auto" takes Deno when it runs, else Node.js when it runs TypeScript', async () => {
  const versions = (found: Record<string, string>) => async (program: string) => found[program];
  assert.deepEqual(await chooseRuntime(settings, versions({ deno: 'deno 2.9.7', node: 'v24.20.0' })), { runtime: 'deno' });
  assert.deepEqual(await chooseRuntime(settings, versions({ node: 'v24.20.0' })), { runtime: 'node' });
  const old = await chooseRuntime(settings, versions({ node: 'v20.19.1' }));
  assert.ok('problem' in old && old.problem.includes('Node.js v20.19.1'), 'Node.js 20 cannot run TypeScript');
  const none = await chooseRuntime(settings, versions({}));
  assert.ok('problem' in none && none.problem.includes('found neither'));
});

test('a runtime that is set must run', async () => {
  const versions = (found: Record<string, string>) => async (program: string) => found[program];
  assert.deepEqual(await chooseRuntime({ ...settings, runtime: 'node' }, versions({ deno: 'deno 2.9.7', node: 'v22.7.0' })), {
    runtime: 'node',
  });
  const deno = await chooseRuntime({ ...settings, runtime: 'deno' }, versions({ node: 'v24.20.0' }));
  assert.ok('problem' in deno && deno.problem.includes('did not find Deno'));
  const node = await chooseRuntime({ ...settings, runtime: 'node', nodePath: '/opt/node' }, versions({ deno: 'deno 2.9.7' }));
  assert.ok('problem' in node && node.problem.includes('did not find "/opt/node"'));
});

test('the debug configuration: the runtime waits for the debugger on the port, for Deno and Node.js', () => {
  const deno = debugConfiguration('/w/a.ts', '/w', 'deno', settings);
  assert.equal(deno.type, 'pwa-node');
  assert.equal(deno.runtimeExecutable, 'deno');
  assert.deepEqual(deno.runtimeArgs, ['run', '--inspect-brk=127.0.0.1:9229', '--allow-all']);
  assert.equal(deno.attachSimplePort, 9229);
  const node = debugConfiguration('/w/a.ts', '/w', 'node', { ...settings, stopOnEntry: false, nodePath: '/opt/node' });
  assert.equal(node.runtimeExecutable, '/opt/node');
  assert.equal(node.runtimeArgs[0], '--inspect-wait=127.0.0.1:9229');
  assert.ok(node.runtimeArgs.includes('--experimental-transform-types'));
  assert.equal(node.program, '/w/a.ts');
});

test('the debug configuration skips the code of Node.js and of Deno', () => {
  for (const runtime of ['deno', 'node'] as const) {
    assert.deepEqual(debugConfiguration('/w/a.ts', '/w', runtime, settings).skipFiles, ['<node_internals>/**', 'ext:*/**']);
  }
});
