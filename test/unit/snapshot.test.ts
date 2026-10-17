import { test } from 'vitest';
import assert from 'node:assert/strict';
import { classifyScope, frameLabel, frameName, isUserFrame, parseWalkerResult, unquote } from '../../src/snapshot.ts';
import type { HeapObject, Value } from '../../src/model.ts';

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

test('frame names of constructors and methods name the class that declares them', () => {
  const objects: Record<number, HeapObject> = {
    1: { id: 1, kind: 'class', type: 'Person', methods: [{ name: 'reset()', isStatic: true }, { name: 'birthday()', isStatic: false }, { name: 'get label', isStatic: false }] },
    2: { id: 2, kind: 'class', type: 'Student', superId: 1, methods: [] },
    3: { id: 3, kind: 'object', type: 'Person', cls: 1 },
    4: { id: 4, kind: 'object', type: 'Student', cls: 2 },
  };
  const ref = (id: number): Value => ({ k: 'ref', id });
  const ann = ref(3);
  const bob = ref(4);
  // Names as VS Code's debugger gives them, with the class of `this` in front.
  assert.equal(frameLabel('Person.birthday', ann, objects), 'Person.birthday');
  assert.equal(frameLabel('Student.birthday', bob, objects), 'Person.birthday', 'the inherited method of Person');
  assert.equal(frameLabel('birthday', bob, objects), 'Person.birthday', 'also without the class in front');
  assert.equal(frameLabel('Student.get label', bob, objects), 'Person.get label');
  assert.equal(frameLabel('Function.reset', ref(2), objects), 'Person.reset', 'a static method called on Student');
  assert.equal(frameLabel('Person', ann, objects), 'Person.constructor');
  assert.equal(frameLabel('Person.Person', ann, objects), 'Person.constructor');
  assert.equal(frameLabel('Student.Person', bob, objects), 'Person.constructor', 'super(...) of Student');
  assert.equal(frameLabel('Student', { k: 'uninit' }, objects), 'Student.constructor', '`this` before super(...) returns');
  assert.equal(
    frameLabel('Student.<instance_members_initializer>', bob, objects, 'Person.constructor'),
    'Person (set up fields)',
    'the fields of Person, set up for a Student',
  );
  assert.equal(frameLabel('<static_initializer>', ref(1), objects), 'Person (set up static variables)');
  assert.equal(frameLabel('Person.<anonymous>', ann, objects), '<anonymous>', 'an arrow function in a method');
  assert.equal(frameLabel('insertionSort', undefined, objects), 'insertionSort');
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
