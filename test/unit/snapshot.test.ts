import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyScope, frameName, isUserFrame, parseWalkerResult, unquote } from '../../src/snapshot.ts';

test('scope names of VS Code’s JavaScript debugger', () => {
  const c = (name: string, expensive = false) => classifyScope({ name, variablesReference: 1, expensive });
  assert.equal(c('Local: insertionSort'), 'local');
  assert.equal(c('Lokal: insertionSort'), 'local');
  assert.equal(c('Block'), 'block');
  assert.equal(c('Closure (makeCounter)'), 'closure');
  assert.equal(c('Module'), 'module');
  assert.equal(c('Global', true), 'global');
  assert.equal(c('Something'), 'other');
});

test('user frames: own files only', () => {
  const f = (path: string | undefined, hint?: string) =>
    isUserFrame({ id: 1, name: 'f', line: 1, column: 1, source: path ? { name: 'x', path } : undefined, presentationHint: hint as any });
  assert.ok(f('/home/s/sort.ts'));
  assert.ok(f('C:\\Users\\s\\sort.ts'));
  assert.ok(!f('ext:deno_console/01_console.js'));
  assert.ok(!f('node:internal/main'));
  assert.ok(!f('/p/node_modules/x/index.js'));
  assert.ok(!f(undefined));
  assert.ok(!f('/home/s/sort.ts', 'label'));
});

test('readable names for the functions that V8 makes for class fields', () => {
  assert.equal(frameName('<instance_members_initializer>'), '(set up fields)');
  assert.equal(frameName('Person.<instance_members_initializer>'), 'Person (set up fields)');
  assert.equal(frameName('<static_initializer>'), '(set up static variables)');
  assert.equal(frameName('insertionSort'), 'insertionSort');
});

test('unquote and parseWalkerResult', () => {
  assert.equal(unquote('"a\\nb"'), 'a\nb');
  assert.equal(unquote("'it\\'s'"), "it's");
  assert.equal(unquote('plain'), 'plain');
  const json = JSON.stringify({ v: 2, vars: [], objects: [], missing: [] });
  assert.ok(parseWalkerResult(json));
  assert.ok(parseWalkerResult(JSON.stringify(json)));
  assert.ok(parseWalkerResult(`'${json}'`));
  assert.equal(parseWalkerResult('{"v":2,"vars":[],"objects":[],"missing'), undefined);
});
