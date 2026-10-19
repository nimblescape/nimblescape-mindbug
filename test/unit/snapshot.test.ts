// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  classifyScope,
  collectSnapshot,
  frameLabel,
  frameName,
  isCommonJsModule,
  isUserFrame,
  localPath,
  parseWalkerResult,
  unquote,
} from '../../src/snapshot.ts';
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
  const f = (path: string | undefined, hint?: string, sourceReference?: number) =>
    isUserFrame({
      id: 1,
      name: 'f',
      line: 1,
      column: 1,
      source: path ? { name: 'x', path, sourceReference } : undefined,
      presentationHint: hint as any,
    });
  assert.ok(f('/home/s/sort.ts'));
  assert.ok(f('/home/s/sort.ts', undefined, 0));
  assert.ok(f('C:\\Users\\s\\sort.ts'));
  assert.ok(f('\\\\server\\share\\sort.ts'));
  assert.ok(!f('ext:deno_console/01_console.js'));
  assert.ok(!f('node:internal/main'));
  assert.ok(!f('/p/node_modules/x/index.js'));
  assert.ok(!f(undefined));
  assert.ok(!f('/home/s/sort.ts', 'label'));
  // Deno's own code, as VS Code's JavaScript debugger names it: a relative path and a sourceReference.
  assert.ok(!f('deno_node/console.ts', undefined, 562595578));
  assert.ok(!f('runtime/90_deno_ns.js', undefined, 179477628));
  assert.ok(!f('core/01_core.js'));
  assert.ok(!f('https://jsr.io/@std/assert/1.0.0/mod.ts'));
});

test('file paths of the URIs of a remote window', () => {
  // VS Code in the browser, and Dev Container windows, give the files of the remote computer as URIs
  assert.equal(localPath('vscode-remote://localhost:8123/tmp/ws/bill.ts'), '/tmp/ws/bill.ts');
  assert.equal(localPath('vscode-remote://dev-container+7b22/workspaces/app/sort.ts'), '/workspaces/app/sort.ts');
  assert.equal(localPath('vscode-remote://ssh-remote+pc/home/s/my%20code/sort.ts'), '/home/s/my code/sort.ts');
  assert.equal(localPath('VSCODE-REMOTE://wsl+Ubuntu/home/s/sort.ts'), '/home/s/sort.ts');
  assert.equal(localPath('vscode-remote://ssh-remote+win/c%3A/Users/s/sort.ts'), 'c:\\Users\\s\\sort.ts');
  assert.equal(localPath('file:///home/s/sort.ts'), '/home/s/sort.ts');
  // A file URI with a server (a UNC path) stays as it is
  assert.equal(localPath('file://server/share/sort.ts'), 'file://server/share/sort.ts');
  // Everything else stays as it is
  assert.equal(localPath('/home/s/sort.ts'), '/home/s/sort.ts');
  assert.equal(localPath('C:\\Users\\s\\sort.ts'), 'C:\\Users\\s\\sort.ts');
  assert.equal(localPath('runtime_main/js/99_main.js'), 'runtime_main/js/99_main.js');
  assert.equal(localPath('ext:deno_console/01_console.js'), 'ext:deno_console/01_console.js');
  assert.equal(localPath('https://jsr.io/@std/assert/1.0.0/mod.ts'), 'https://jsr.io/@std/assert/1.0.0/mod.ts');
  assert.equal(localPath('vscode-remote://localhost:8123/tmp/%E0%A4%A.ts'), 'vscode-remote://localhost:8123/tmp/%E0%A4%A.ts');
});

test('a remote window: the frames of the own files are read, with their file paths', async () => {
  // The stack frames as customRequest('stackTrace') returns them in VS Code in the browser
  const requests: string[] = [];
  const dap = {
    async request(command: string): Promise<any> {
      requests.push(command);
      if (command === 'stackTrace') {
        return {
          stackFrames: [
            {
              id: 7,
              name: '<anonymous>',
              line: 13,
              column: 1,
              source: { name: 'bill.ts', path: 'vscode-remote://localhost:8123/tmp/ws/bill.ts', sourceReference: 0 },
            },
          ],
        };
      }
      if (command === 'scopes') return { scopes: [] };
      throw new Error('not in this test');
    },
  };
  const snapshot = await collectSnapshot(dap, 1, 1);
  assert.equal(snapshot.location, 'bill.ts:13');
  assert.equal(snapshot.frames.length, 1);
  assert.equal(snapshot.frames[0].file, '/tmp/ws/bill.ts');
  assert.ok(requests.includes('scopes'), 'the frame is read');
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
  assert.equal(frameLabel('Person.constructor', ann, objects), 'Person.constructor', 'the name of the VS Code test');
  assert.equal(frameLabel('Person.constructor', bob, objects), 'Person.constructor', 'super(...) in the VS Code test');
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
  // Node.js: in a function that runs without an object, `this` is the global object (not shown).
  assert.equal(frameLabel('global.insertionSort', undefined, objects), 'insertionSort');
});

test('a constructor shows no return value, a function shows its return value', async () => {
  // The frames at a return, newest first, as VS Code's JavaScript debugger gives them: the set-up of the fields of
  // new Book(...), the constructor of Book, the function createBook, and the module. At a return, the debugger adds
  // the return value to the local scope, with a name in the display language of VS Code.
  const stack = (returnValue: string) => [
    { name: '<instance_members_initializer>', locals: [['this', 'Book'], [returnValue, 'undefined']] },
    { name: 'Book', locals: [['this', 'Book'], ['pages', '250'], [returnValue, 'undefined'], ['title', "'TypeScript'"]] },
    { name: 'createBook', locals: [['book', 'Book'], ['pages', '250'], [returnValue, 'Book'], ['title', "'TypeScript'"]] },
    { name: '<anonymous>', module: [['Book', 'class Book'], ['createBook', 'ƒ createBook(title, pages)']] },
  ];
  const objects: HeapObject[] = [
    { id: 1, kind: 'class', type: 'Book', methods: [], attrs: ['title', 'pages'] },
    { id: 2, kind: 'object', type: 'Book', cls: 1, fields: [] },
    { id: 3, kind: 'function', type: 'createBook' },
  ];
  const readable: Record<string, Value> = {
    this: { k: 'ref', id: 2 },
    book: { k: 'ref', id: 2 },
    pages: { k: 'num', v: '250' },
    title: { k: 'str', v: 'TypeScript' },
    Book: { k: 'ref', id: 1 },
    createBook: { k: 'ref', id: 3 },
  };
  const snapshotAt = (returnValue: string) => {
    const frames = stack(returnValue);
    const dap = {
      async request(command: string, args: any): Promise<any> {
        if (command === 'stackTrace') {
          return {
            stackFrames: frames.map((f, id) => ({ id, name: f.name, line: 26, column: 1, source: { name: 'book.ts', path: '/s/book.ts' } })),
          };
        }
        if (command === 'scopes') {
          const f = frames[args.frameId];
          return { scopes: [{ name: f.module ? 'Module' : `Local: ${f.name}`, variablesReference: 100 + args.frameId }] };
        }
        if (command === 'variables') {
          const f = frames[args.variablesReference - 100];
          return { variables: (f.locals ?? f.module ?? []).map(([name, value]) => ({ name, value, variablesReference: 0 })) };
        }
        if (command === 'evaluate') {
          if (!args.expression.includes('.begin(')) return { result: 'true' }; // the install of the helper
          // The helper reads each name in the frame; a name that is not a variable is not defined.
          const names = [...args.expression.matchAll(/\.v\("([^"]+)"/g)].map((m: RegExpMatchArray) => m[1]);
          const self = frames[args.frameId].locals?.some(([name]) => name === 'this');
          const value = (name: string): Value =>
            name === 'this' && !self ? { k: 'undef' } : (readable[name] ?? { k: 'unavail', v: `${name} is not defined` });
          const vars = names.map((name) => ({ name, value: value(name) }));
          return { result: JSON.stringify({ v: 1, vars, objects, missing: [] }) };
        }
        throw new Error('not in this test');
      },
    };
    return collectSnapshot(dap, 1, 1);
  };

  for (const returnValue of ['Return value', 'Rückgabewert']) {
    const s = await snapshotAt(returnValue);
    const names = (frame: string) => s.frames.find((f) => f.name === frame)?.vars.map((v) => v.name);
    assert.deepEqual(
      s.frames.map((f) => f.name),
      ['Global scope', 'createBook', 'Book.constructor', 'Book (set up fields)'],
    );
    assert.deepEqual(names('Book.constructor'), ['this', 'pages', 'title'], `no ${returnValue} in the constructor`);
    assert.deepEqual(names('Book (set up fields)'), ['this'], `no ${returnValue} in the set-up of the fields`);
    assert.deepEqual(names('createBook'), ['book', 'pages', returnValue, 'title'], `the ${returnValue} of a function`);
  }
});

test('Node.js runs a file without import or export in a function: its frame is the Global scope', () => {
  const params = ['exports', 'require', 'module', '__filename', '__dirname'];
  assert.ok(isCommonJsModule('<anonymous>', true, ['this', ...params, 'arr1']));
  assert.ok(!isCommonJsModule('<anonymous>', false, params), 'only the outermost frame');
  assert.ok(!isCommonJsModule('insertionSort', true, params), 'only a frame without a name');
  assert.ok(!isCommonJsModule('<anonymous>', true, ['arr1', 'require']), 'only with all parameters of the module');
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
