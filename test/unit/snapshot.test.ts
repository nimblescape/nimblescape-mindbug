// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  classifyScope,
  collectSnapshot,
  type DapClient,
  type DapStackFrame,
  frameLabel,
  frameName,
  isCommonJsModule,
  isUserFrame,
  localPath,
  matchCallFrames,
  parseWalkerResult,
  remoteValue,
  RETURN_VALUE,
  callArgument,
} from '../../src/snapshot.ts';
import { installFunction, WALKER_VERSION, walkerFunction } from '../../src/heapWalker.ts';
import type { HeapObject, Value } from '../../src/model.ts';
import type { CdpCallFrame, CdpClient, CdpRemoteObject } from '../../src/v8Connection.ts';

/** A frame of the student's code as VS Code's JavaScript debugger gives it in the stack trace. */
const dapFrame = (id: number, name: string, line = 1): DapStackFrame => ({
  id,
  name,
  line,
  column: 1,
  source: { name: 'book.ts', path: '/s/book.ts' },
});

/** A debugger that answers only the request stackTrace. */
const stackTrace = (frames: DapStackFrame[], requests: string[] = []): DapClient => ({
  async request(command: string): Promise<any> {
    requests.push(command);
    if (command === 'stackTrace') return { stackFrames: frames };
    throw new Error('not in this test');
  },
});

/** A call frame of V8 with the given scopes (innermost first), each with its variables in the order of V8. */
interface FakeCallFrame {
  functionName: string;
  /** `start`: where V8 says that the scope starts in SOURCE (line and column from 0). */
  scopes: { type: string; vars: [string, CdpRemoteObject | undefined][]; start?: [number, number] }[];
  this?: CdpRemoteObject;
  returnValue?: CdpRemoteObject;
}

/**
 * V8 for the collector: the call frames, their scopes, and the heap walker. `walker` gives the value that the heap
 * walker reads for a variable of a frame, by its name and the index of its scope; `calledIn` collects the frames on
 * whose global object a function of Mindbug ran. The fake gives every value an object id that names its variable, so it
 * knows the variable of each value that goes to the walker (V8 gives object ids only to objects).
 */
function fakeV8(
  frames: FakeCallFrame[],
  walker: (frame: number, name: string, scope: number) => Value,
  objects: HeapObject[] = [],
  calledIn = new Set<number>(),
  requests: string[] = [],
): CdpClient {
  const tagged = (o: CdpRemoteObject | undefined, id: string) => (o ? { ...o, objectId: id } : undefined);
  const callFrames: CdpCallFrame[] = frames.map((f, i) => ({
    callFrameId: `frame:${i}`,
    functionName: f.functionName,
    url: 'file:///s/book.ts',
    scopeChain: f.scopes.map((s, j) => ({
      type: s.type,
      object: { type: 'object', objectId: `scope:${i}:${j}` },
      ...(s.start ? { startLocation: { scriptId: 'book', lineNumber: s.start[0], columnNumber: s.start[1] } } : {}),
    })),
    this: tagged(f.this ?? { type: 'undefined' }, `var|${i}|-1|this`)!,
    returnValue: tagged(f.returnValue, `var|${i}|0|${RETURN_VALUE}`),
  }));
  return {
    async callFrames() {
      return callFrames;
    },
    async send(method: string, params: any): Promise<any> {
      requests.push(method);
      if (method === 'Debugger.getScriptSource') {
        assert.equal(params.scriptId, 'book');
        return { scriptSource: SOURCE };
      }
      if (method === 'Runtime.getProperties') {
        const [, i, j] = String(params.objectId).split(':').map(Number);
        return { result: frames[i].scopes[j].vars.map(([name, value]) => ({ name, value: tagged(value, `var|${i}|${j}|${name}`) })) };
      }
      if (method === 'Runtime.callFunctionOn') {
        const i = Number(String(params.objectId).split(':')[1]);
        calledIn.add(i);
        if (params.functionDeclaration === installFunction()) return { result: { type: 'string', value: 'installed' } };
        assert.equal(params.functionDeclaration, walkerFunction());
        // The first argument is the limits, the others the values of the variables.
        const vars = params.arguments.slice(1).map((a: { objectId: string }, k: number) => {
          const [, , j, name] = a.objectId.split('|');
          return { name: String(k), value: walker(i, name, Number(j)) };
        });
        return { result: { type: 'string', value: JSON.stringify({ v: WALKER_VERSION, vars, objects, missing: [] }) } };
      }
      throw new Error(`not in this test: ${method}`);
    },
  };
}

const num = (v: number): CdpRemoteObject => ({ type: 'number', value: v, description: String(v) });

/** The code of the program, as the runtime runs it. */
const SOURCE = ['function shop(prices) {', '  let sum = 0;', '  for (const price of prices) {', '    if (price > 4) {', '      const note = 3;', '    }', '  }', '}'].join('\n');

/** Line and column (from 0) of `text` in SOURCE, from the line `line` on. */
function at(text: string, line: number): [number, number] {
  const lines = SOURCE.split('\n');
  return [line, lines[line].indexOf(text)];
}

test('scope types of V8', () => {
  assert.equal(classifyScope('local'), 'local');
  assert.equal(classifyScope('block'), 'block');
  assert.equal(classifyScope('catch'), 'block');
  assert.equal(classifyScope('closure'), 'closure');
  assert.equal(classifyScope('module'), 'module');
  assert.equal(classifyScope('script'), 'module');
  assert.equal(classifyScope('global'), 'global');
  assert.equal(classifyScope('eval'), 'other');
});

test('values of V8', () => {
  assert.deepEqual(remoteValue(undefined), { k: 'uninit' }, 'a let before its line has no value');
  assert.deepEqual(remoteValue({ type: 'undefined' }), { k: 'undef' });
  assert.deepEqual(remoteValue(num(250)), { k: 'num', v: '250' });
  assert.deepEqual(remoteValue({ type: 'number', unserializableValue: '-0', description: '-0' }), { k: 'num', v: '-0' });
  assert.deepEqual(remoteValue({ type: 'string', value: 'BMW' }), { k: 'str', v: 'BMW' });
  assert.deepEqual(remoteValue({ type: 'boolean', value: false }), { k: 'bool', v: false });
  assert.deepEqual(remoteValue({ type: 'bigint', unserializableValue: '10n' }), { k: 'big', v: '10n' });
  assert.deepEqual(remoteValue({ type: 'object', subtype: 'null', value: null }), { k: 'null' });
  assert.deepEqual(remoteValue({ type: 'object', className: 'Book', description: 'Book', objectId: '1' }), {
    k: 'text',
    v: 'Book',
  });
});

test('values of V8 as arguments of a function call', () => {
  assert.deepEqual(callArgument({ type: 'object', className: 'Car', objectId: '7' }), { objectId: '7' });
  assert.deepEqual(callArgument({ type: 'symbol', description: 'Symbol(id)', objectId: '8' }), { objectId: '8' });
  assert.deepEqual(callArgument(num(250)), { value: 250 });
  assert.deepEqual(callArgument({ type: 'string', value: 'BMW' }), { value: 'BMW' });
  assert.deepEqual(callArgument({ type: 'object', subtype: 'null', value: null }), { value: null });
  assert.deepEqual(callArgument({ type: 'number', unserializableValue: '-0', description: '-0' }), {
    unserializableValue: '-0',
  });
  assert.deepEqual(callArgument({ type: 'bigint', unserializableValue: '10n' }), { unserializableValue: '10n' });
  assert.deepEqual(callArgument({ type: 'undefined' }), {}, 'an argument without a value is undefined');
});

test('a variable of a block with the name of a variable of its scope: both are shown, with their own values', async () => {
  // let a = { x: 10 }; let b = 20; { let a = { x: 200 }; let c = 500; ... } — paused in the block.
  const dap = stackTrace([dapFrame(1, '<anonymous>', 27)]);
  const obj = (id: string): CdpRemoteObject => ({ type: 'object', className: 'Object', description: 'Object', objectId: id });
  const frames: FakeCallFrame[] = [
    {
      functionName: '',
      scopes: [
        { type: 'block', vars: [['a', obj('inner')], ['c', undefined]] },
        { type: 'module', vars: [['a', obj('outer')], ['b', num(20)]] },
        { type: 'global', vars: [] },
      ],
    },
  ];
  const walker = (_frame: number, name: string, scope: number): Value =>
    name === 'a' ? { k: 'ref', id: scope === 0 ? 2 : 1 } : name === 'b' ? { k: 'num', v: '20' } : { k: 'undef' };
  const s = await collectSnapshot(dap, fakeV8(frames, walker), 1, 1);
  assert.deepEqual(s.frames[0].vars, [
    { name: 'a', value: { k: 'ref', id: 1 }, scope: 'module' },
    { name: 'b', value: { k: 'num', v: '20' }, scope: 'module' },
    { name: 'a', value: { k: 'ref', id: 2 }, scope: 'block', block: 1 },
    { name: 'c', value: { k: 'uninit' }, scope: 'block', block: 1 },
  ]);
});

test('blocks inside blocks get their numbers from the outermost block', async () => {
  const dap = stackTrace([dapFrame(1, 'shop')]);
  const frames: FakeCallFrame[] = [
    {
      functionName: 'shop',
      scopes: [
        { type: 'block', vars: [['note', num(3)]] },
        { type: 'block', vars: [['price', num(5)]] },
        { type: 'local', vars: [['sum', num(0)]] },
        { type: 'global', vars: [] },
      ],
    },
  ];
  const walker = (_frame: number, name: string): Value => (name === 'this' ? { k: 'undef' } : { k: 'num', v: '1' });
  const s = await collectSnapshot(dap, fakeV8(frames, walker), 1, 1);
  assert.deepEqual(
    s.frames[0].vars.map((v) => [v.name, v.scope, v.block]),
    [
      ['sum', 'local', undefined],
      ['price', 'block', 1],
      ['note', 'block', 2],
    ],
  );
});

test('each block scope is named after its statement, from the code where V8 says that it starts', async () => {
  const dap = stackTrace([dapFrame(1, 'shop', 5)]);
  const frames: FakeCallFrame[] = [
    {
      functionName: 'shop',
      scopes: [
        { type: 'block', vars: [['note', num(3)]], start: at('{', 3) },
        { type: 'block', vars: [], start: at('{', 2) },
        { type: 'block', vars: [['price', num(5)]], start: at('const price', 2) },
        { type: 'local', vars: [['sum', num(5)]], start: at('(prices)', 0) },
        { type: 'global', vars: [] },
      ],
    },
  ];
  const walker = (_frame: number, name: string): Value => (name === 'this' ? { k: 'undef' } : { k: 'num', v: '1' });
  const requests: string[] = [];
  const v8 = fakeV8(frames, walker, [], new Set(), requests);
  const s = await collectSnapshot(dap, v8, 1, 1);
  assert.deepEqual(s.frames[0].blocks, ['for', 'for body', 'if']);
  assert.deepEqual(
    s.frames[0].vars.map((v) => [v.name, v.block]),
    [
      ['sum', undefined],
      ['price', 1],
      ['note', 3],
    ],
  );
  // The code of a script does not change: V8 sends it once.
  await collectSnapshot(dap, v8, 1, 2);
  assert.equal(requests.filter((m) => m === 'Debugger.getScriptSource').length, 1);
});

test('a block scope without a position is a plain block', async () => {
  const dap = stackTrace([dapFrame(1, 'shop')]);
  const frames: FakeCallFrame[] = [
    {
      functionName: 'shop',
      scopes: [
        { type: 'catch', vars: [['error', num(1)]] },
        { type: 'block', vars: [['price', num(5)]] },
        { type: 'local', vars: [] },
        { type: 'global', vars: [] },
      ],
    },
  ];
  const walker = (): Value => ({ k: 'num', v: '1' });
  const s = await collectSnapshot(dap, fakeV8(frames, walker), 1, 1);
  assert.deepEqual(s.frames[0].blocks, ['block', 'catch']);
});

test('the call frames of V8 for the frames of the student’s code', () => {
  const cf = (functionName: string): CdpCallFrame => ({
    callFrameId: functionName,
    functionName,
    url: '',
    scopeChain: [],
    this: { type: 'undefined' },
  });
  const frames = [dapFrame(1, 'inner'), { ...dapFrame(2, 'run'), source: { path: 'node:internal/x' } }, dapFrame(3, 'outer')];
  assert.deepEqual(
    matchCallFrames([cf('inner'), cf('run'), cf('outer')], frames, [0, 2]),
    [cf('inner'), cf('outer')],
  );
  // The frames after an async boundary are not call frames of V8.
  const label = { ...dapFrame(4, 'async'), presentationHint: 'label' };
  assert.deepEqual(matchCallFrames([cf('inner'), cf('run'), cf('outer')], [...frames, label, dapFrame(5, 'main')], [0, 2]), [
    cf('inner'),
    cf('outer'),
  ]);
  // Another number of frames: the stack changed between the two answers.
  assert.equal(matchCallFrames([cf('inner'), cf('outer')], frames, [0, 2]), undefined);
  // The debugger gives at most 200 frames; V8 gives all.
  const deep = Array.from({ length: 200 }, (_, i) => dapFrame(i, `f${i}`));
  const deepV8 = Array.from({ length: 250 }, (_, i) => cf(`f${i}`));
  assert.deepEqual(matchCallFrames(deepV8, deep, [0, 1]), [cf('f0'), cf('f1')]);
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

test('a remote window: the frames of the own files are read, with their file paths, and one DAP request', async () => {
  // The stack frames as customRequest('stackTrace') returns them in VS Code in the browser
  const requests: string[] = [];
  const dap = stackTrace(
    [
      {
        id: 7,
        name: '<anonymous>',
        line: 13,
        column: 1,
        source: { name: 'bill.ts', path: 'vscode-remote://localhost:8123/tmp/ws/bill.ts', sourceReference: 0 },
      },
    ],
    requests,
  );
  const v8 = fakeV8([{ functionName: '', scopes: [{ type: 'module', vars: [['total', num(12)]] }] }], () => ({
    k: 'num',
    v: '12',
  }));
  const snapshot = await collectSnapshot(dap, v8, 1, 1);
  assert.equal(snapshot.location, 'bill.ts:13');
  assert.equal(snapshot.frames.length, 1);
  assert.equal(snapshot.frames[0].file, '/tmp/ws/bill.ts');
  assert.deepEqual(snapshot.frames[0].vars, [{ name: 'total', value: { k: 'num', v: '12' }, scope: 'module' }]);
  assert.deepEqual(requests, ['stackTrace'], 'only the stack trace goes through the window');
});

test('the variables keep the order of V8: own variables, then blocks from the outer to the inner, then closures', async () => {
  const dap = stackTrace([dapFrame(1, 'swap'), dapFrame(2, '<anonymous>')]);
  const frames: FakeCallFrame[] = [
    {
      functionName: 'swap',
      scopes: [
        { type: 'block', vars: [['kept', num(1)]] },
        { type: 'block', vars: [['temp', num(2)]] },
        // A `var` before its line is undefined, a `let` before its line has no value.
        {
          type: 'local',
          vars: [
            ['values', { type: 'object', className: 'Array', description: 'Array(2)' }],
            ['second', num(1)],
            ['first', num(0)],
            ['later', { type: 'undefined' }],
            ['total', undefined],
          ],
        },
        { type: 'closure', vars: [['zeta', num(26)], ['alpha', num(1)]] },
        { type: 'global', vars: [['console', { type: 'object', description: 'console' }]] },
      ],
    },
    {
      functionName: '',
      scopes: [{ type: 'module', vars: [['zeta', num(26)], ['alpha', num(1)], ['swap', { type: 'function' }]] }],
    },
  ];
  // Without the heap walker (it is not installed and cannot be installed), the values of V8 are shown.
  const v8 = fakeV8(frames, () => ({ k: 'unavail', v: 'not read' }));
  const noWalker: CdpClient = {
    callFrames: () => v8.callFrames(),
    send: (method, params) =>
      method === 'Runtime.callFunctionOn'
        ? Promise.resolve({ result: { type: 'string', value: 'mindbug: not installed' } })
        : v8.send(method, params),
  };
  const s = await collectSnapshot(dap, noWalker, 1, 2);
  const swap = s.frames.find((f) => f.name === 'swap')!;
  assert.deepEqual(
    swap.vars.map((v) => [v.name, v.scope]),
    [
      ['values', 'local'],
      ['second', 'local'],
      ['first', 'local'],
      ['later', 'local'],
      ['total', 'local'],
      ['temp', 'block'],
      ['kept', 'block'],
      ['zeta', 'closure'],
      ['alpha', 'closure'],
    ],
  );
  assert.deepEqual(swap.vars.find((v) => v.name === 'later')?.value, { k: 'undef' });
  assert.deepEqual(swap.vars.find((v) => v.name === 'total')?.value, { k: 'uninit' });
  assert.deepEqual(swap.vars.find((v) => v.name === 'values')?.value, { k: 'text', v: 'Array(2)' });
  assert.deepEqual(
    s.frames[0].vars.map((v) => v.name),
    ['zeta', 'alpha', 'swap'],
  );
  assert.equal(s.fallback, true);
});

test('a stack that changed between the answers of the debugger and of V8 is not read', async () => {
  const dap = stackTrace([dapFrame(1, 'inner'), dapFrame(2, '<anonymous>')]);
  const v8 = fakeV8([{ functionName: '', scopes: [] }], () => ({ k: 'undef' }));
  await assert.rejects(collectSnapshot(dap, v8, 1, 1), /call frames of V8 do not match/);
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

test('a constructor shows no return value, a function shows its return value; no helper in the set-up of fields', async () => {
  // The frames at a return, newest first: the set-up of the fields of new Book(...), the constructor of Book, the
  // function createBook, and the module. At a return, V8 gives the return value with the call frame.
  const book: CdpRemoteObject = { type: 'object', className: 'Book', description: 'Book', objectId: 'book' };
  const undef: CdpRemoteObject = { type: 'undefined' };
  const title: CdpRemoteObject = { type: 'string', value: 'TypeScript' };
  const frames: FakeCallFrame[] = [
    { functionName: '<instance_members_initializer>', scopes: [{ type: 'local', vars: [] }], this: book, returnValue: undef },
    {
      functionName: 'Book',
      scopes: [{ type: 'local', vars: [['title', title], ['pages', num(250)]] }],
      this: book,
      returnValue: undef,
    },
    {
      functionName: 'createBook',
      scopes: [{ type: 'local', vars: [['title', title], ['pages', num(250)], ['book', book]] }],
      returnValue: book,
    },
    {
      functionName: '',
      scopes: [{ type: 'module', vars: [['Book', { type: 'function' }], ['createBook', { type: 'function' }]] }],
    },
  ];
  const objects: HeapObject[] = [
    { id: 1, kind: 'class', type: 'Book', methods: [], attrs: ['title', 'pages'] },
    { id: 2, kind: 'object', type: 'Book', cls: 1, fields: [] },
    { id: 3, kind: 'function', type: 'createBook' },
  ];
  const readable: Record<string, Value> = {
    book: { k: 'ref', id: 2 },
    pages: { k: 'num', v: '250' },
    title: { k: 'str', v: 'TypeScript' },
    Book: { k: 'ref', id: 1 },
    createBook: { k: 'ref', id: 3 },
  };
  const walker = (i: number, name: string): Value => {
    if (name === 'this') return frames[i].this ? { k: 'ref', id: 2 } : { k: 'undef' };
    if (name === RETURN_VALUE) return frames[i].returnValue === book ? { k: 'ref', id: 2 } : { k: 'undef' };
    return readable[name] ?? { k: 'unavail', v: `${name} is not defined` };
  };
  /** The frames on whose global object a function of Mindbug ran. */
  const calledIn = new Set<number>();
  const dap = stackTrace(frames.map((f, id) => dapFrame(id, f.functionName || '<anonymous>', 26)));
  const s = await collectSnapshot(dap, fakeV8(frames, walker, objects, calledIn), 1, 1);

  const names = (frame: string) => s.frames.find((f) => f.name === frame)?.vars.map((v) => v.name);
  assert.deepEqual(
    s.frames.map((f) => f.name),
    ['Global scope', 'createBook', 'Book.constructor', 'Book (set up fields)'],
  );
  assert.deepEqual(names('Book.constructor'), ['this', 'title', 'pages'], 'no return value in the constructor');
  assert.deepEqual(names('Book (set up fields)'), ['this'], 'no return value in the set-up of the fields');
  assert.deepEqual(names('createBook'), ['title', 'pages', 'book', 'Return value'], 'the return value of a function');
  assert.deepEqual(s.frames[1].vars.at(-1)?.value, { k: 'ref', id: 2 }, 'the return value points to the new book');
  // Node.js 22 stops with a fatal error when code is evaluated in the frame of <instance_members_initializer>. Mindbug
  // runs no function for that frame; its `this` is the object of the constructor.
  assert.ok(!calledIn.has(0), 'no function of Mindbug for the set-up of the fields');
  assert.deepEqual(s.frames[3].vars, [{ name: 'this', value: { k: 'ref', id: 2 }, scope: 'local' }]);
});

test('Node.js runs a file without import or export in a function: its frame is the Global scope', () => {
  const params = ['exports', 'require', 'module', '__filename', '__dirname'];
  assert.ok(isCommonJsModule('<anonymous>', true, ['this', ...params, 'arr1']));
  assert.ok(!isCommonJsModule('<anonymous>', false, params), 'only the outermost frame');
  assert.ok(!isCommonJsModule('insertionSort', true, params), 'only a frame without a name');
  assert.ok(!isCommonJsModule('<anonymous>', true, ['arr1', 'require']), 'only with all parameters of the module');
});

test('parseWalkerResult', () => {
  const json = JSON.stringify({ v: 5, vars: [], objects: [], missing: [] });
  assert.ok(parseWalkerResult(json));
  assert.equal(parseWalkerResult('{"v":5,"vars":[],"objects":[],"missing'), undefined);
  assert.equal(parseWalkerResult('"text"'), undefined);
});
