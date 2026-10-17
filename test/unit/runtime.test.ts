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
  assert.equal(await chooseRuntime(settings, versions({ deno: 'deno 2.9.7', node: 'v24.20.0' })), 'deno');
  assert.equal(await chooseRuntime(settings, versions({ node: 'v24.20.0' })), 'node');
  assert.equal(await chooseRuntime(settings, versions({ node: 'v20.19.1' })), undefined, 'Node.js 20 cannot run TypeScript');
  assert.equal(await chooseRuntime(settings, versions({})), undefined);
  assert.equal(await chooseRuntime({ ...settings, runtime: 'node' }, versions({ deno: 'deno 2.9.7' })), 'node', 'a set runtime is not probed');
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
