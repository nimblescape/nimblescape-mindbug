// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

/// <reference types="mocha" />
// Tests in a real VS Code (npm run test:vscode, .vscode-test.mjs): mocha runs them in the extension host. They debug
// the example programs through VS Code's built-in JavaScript debugger and check the snapshots of the extension. The same
// checks run for each way to start a program (STARTS): the view must not depend on the runtime.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MindbugApi } from '../../src/extension.ts';
import type { MemorySnapshot, Value } from '../../src/model.ts';

const TIMEOUT = 60000;

function examples(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the examples folder is open');
  return folder.uri.fsPath;
}

function top(s: MemorySnapshot) {
  return s.frames[s.frames.length - 1];
}

function variable(s: MemorySnapshot, frame: string, name: string): Value {
  const f = s.frames.find((x) => x.name === frame);
  assert.ok(f, `frame ${frame} in ${s.frames.map((x) => x.name).join(', ')}`);
  const v = f.vars.find((x) => x.name === name);
  assert.ok(v, `variable ${name} in frame ${frame}`);
  return v.value;
}

function idOf(v: Value): number {
  assert.equal(v.k, 'ref');
  return (v as { id: number }).id;
}

/** Continues until the program pauses at `line` of `file`. */
async function runToLine(api: MindbugApi, file: string, line: number): Promise<MemorySnapshot> {
  for (let i = 0; i < 10; i++) {
    const last = api.lastSnapshot();
    if (last && top(last)?.file === file && top(last)?.line === line) return last;
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('workbench.action.debug.continue');
    const s = await next;
    if (top(s)?.file === file && top(s)?.line === line) return s;
  }
  throw new Error(`the program did not pause at line ${line}`);
}

/**
 * A way to start a program: the command "Run with Mindbug", a launch configuration of type "mindbug", an own launch
 * configuration of the debug type "ts" of the extension nimblescape TypeScript, or one of VS Code's JavaScript
 * debugger.
 */
interface Start {
  title: string;
  run(file: string): Thenable<unknown>;
  /** True when the first pause is at the first statement of the program. */
  pausesAtFirstStatement: boolean;
  /** True for the starts through the debug type "mindbug", which Mindbug turns into a configuration of type "ts". */
  mindbug: boolean;
  /** True when the command ts compiles the program, so all of TypeScript runs, also enums and parameter properties. */
  compiles: boolean;
}

function runWithMindbug(file: string): Thenable<boolean | undefined> {
  return vscode.commands.executeCommand<boolean>('nimblescape.mindbug.run', vscode.Uri.file(file));
}

const STARTS: Start[] = [
  { title: 'Run with Mindbug', run: runWithMindbug, pausesAtFirstStatement: true, mindbug: true, compiles: true },
  {
    // A launch.json configuration of type "mindbug" for the file of the active editor.
    title: 'launch configuration of type "mindbug"',
    pausesAtFirstStatement: true,
    mindbug: true,
    compiles: true,
    run: () =>
      vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'mindbug',
        request: 'launch',
        name: 'Mindbug: current file',
        program: '${file}',
      }),
  },
  {
    // The launch.json of a course: nothing in it is about Mindbug. The debug type "ts" stops at the first statement.
    title: 'own launch configuration of type "ts"',
    pausesAtFirstStatement: true,
    mindbug: false,
    compiles: true,
    run: (file) =>
      vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'ts',
        request: 'launch',
        name: 'ts: current file',
        program: file,
        stopOnEntry: true,
      }),
  },
  {
    // A launch configuration of VS Code's JavaScript debugger: Node.js from the PATH only strips the types.
    // With stopOnEntry, the debugger stops at the first line of the file that can stop, which can be inside a function.
    title: 'own launch configuration, Node.js',
    pausesAtFirstStatement: false,
    mindbug: false,
    compiles: false,
    run: (file) =>
      vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'node',
        request: 'launch',
        name: 'Node.js: current file',
        program: file,
        stopOnEntry: true,
        console: 'internalConsole',
      }),
  },
];

/** Starts `file` and returns the snapshot of the first pause (stop on entry). */
async function debug(api: MindbugApi, start: Start, file: string, breakpointLines: number[]): Promise<MemorySnapshot> {
  const uri = vscode.Uri.file(file);
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  vscode.debug.addBreakpoints(
    breakpointLines.map((l) => new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(l - 1, 0)))),
  );
  await vscode.window.showTextDocument(uri);
  const first = api.nextSnapshot(TIMEOUT);
  const sessions: vscode.DebugSession[] = [];
  const started = vscode.debug.onDidStartDebugSession((s) => sessions.push(s));
  try {
    assert.ok(await start.run(file), 'the debug session starts');
    const snapshot = await first;
    if (start.mindbug) {
      // The debug type "mindbug" becomes a configuration of type "ts", and the debug type "ts" turns it into one of
      // VS Code's JavaScript debugger that runs the command ts with the file. The pause at the first statement
      // (stopOnEntry) is checked by the first snapshot of each test.
      const config = sessions[0]?.configuration;
      assert.equal(sessions[0]?.type, 'pwa-node');
      assert.match(path.basename(String(config?.runtimeExecutable)), /^ts(\.cmd)?$/);
      assert.equal(config?.args?.[0], file);
    }
    return snapshot;
  } finally {
    started.dispose();
  }
}

/** Waits until an editor shows `line` of `file`. */
async function waitForVisibleLine(file: string, line: number): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === file);
    if (editor?.visibleRanges.some((r) => r.start.line <= line - 1 && line - 1 <= r.end.line)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no editor shows line ${line} of ${path.basename(file)}`);
}

async function closeTextEditors(): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputText);
  await vscode.window.tabGroups.close(tabs);
}

async function stop(): Promise<void> {
  const ended = new Promise<void>((resolve) => {
    const d = vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.parentSession) return;
      d.dispose();
      resolve();
    });
    setTimeout(resolve, 5000);
  });
  await vscode.debug.stopDebugging();
  await ended;
}

/**
 * Variables in an order that is not the order of their names. VS Code's JavaScript debugger sorts the variables of a
 * scope by name, so the view showed a, b, bmw, toyota, and the variables of a block in the reverse order.
 */
const ORDER_PROGRAM = `// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

class Car {
  brand: string;
  constructor(brand: string) {
    this.brand = brand;
  }
}

let bmw: Car; // a variable on the stack
bmw = new Car('BMW');
let toyota: Car = new Car('Toyota');
let a = 10;
let b = 20;

function swap(values: number[], second: number, first: number): void {
  const kept = values[first];
  values[first] = values[second];
  values[second] = kept;
  debugger;
}

{
  let zeta = a + b;
  let alpha = zeta;
  swap([a, b], 1, 0);
  console.log(alpha);
}
console.log(bmw, toyota);
`;

async function variableOrder(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'order-test.ts');
  fs.writeFileSync(file, ORDER_PROGRAM);
  try {
    await debug(api, start, file, []);
    const s = await runToLine(api, file, 22);
    assert.deepEqual(
      s.frames.map((f) => f.name),
      ['Global scope', 'swap'],
    );
    const names = (frame: number) => s.frames[frame].vars.map((v) => v.name).filter((n) => n !== 'this');
    // The view draws the variables bottom up: bmw at the bottom of the Global scope, values at the bottom of swap.
    // Node.js does not list the class and the function in the Global scope.
    const global = ['Car', 'bmw', 'toyota', 'a', 'b', 'swap', 'zeta', 'alpha'];
    assert.deepEqual(
      names(0).filter((n) => global.includes(n)),
      global.filter((n) => names(0).includes(n)),
    );
    assert.deepEqual(names(0).filter((n) => !['Car', 'swap'].includes(n)), ['bmw', 'toyota', 'a', 'b', 'zeta', 'alpha']);
    assert.deepEqual(names(1), ['values', 'second', 'first', 'kept']);
    await stop();
  } finally {
    await closeTextEditors();
    fs.rmSync(file, { force: true });
  }
}

async function varAndLet(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'var-and-let.ts');
  // No breakpoint before the first pause: a breakpoint can hide the pause at the first statement (see insertionSort).
  let s = await debug(api, start, file, []);
  if (start.pausesAtFirstStatement) {
    // At the first line, the Global scope already has all its variables.
    assert.equal(top(s).line, 20);
    assert.deepEqual(variable(s, 'Global scope', 'label'), { k: 'undef' });
    assert.deepEqual(variable(s, 'Global scope', 'total'), { k: 'uninit' });
    assert.equal(s.objects[idOf(variable(s, 'Global scope', 'shop'))]?.kind, 'function');
  }
  const locals = (snapshot: MemorySnapshot) =>
    top(snapshot)
      .vars.filter((v) => v.scope === 'local' && v.name !== 'this')
      .map((v) => [v.name, v.value.k === 'ref' ? 'ref' : v.value]);
  // Steps, not breakpoints: a breakpoint that is added while the program is paused can come too late for the next
  // continue. In the call of shop, the var note is a variable of the function, although its line is inside a block.
  s = await step(api, 'stepOver');
  assert.equal(top(s).line, 21);
  s = await step(api, 'stepInto');
  assert.equal(top(s).name, 'shop');
  assert.equal(top(s).line, 25);
  assert.deepEqual(locals(s), [
    ['prices', 'ref'],
    ['sum', { k: 'uninit' }],
    ['note', { k: 'undef' }],
  ]);
  // After the loop, note keeps its value, and the variables of the blocks of the loop are gone.
  for (let i = 0; i < 40 && top(s).line !== 33; i++) s = await step(api, 'stepOver');
  assert.equal(top(s).line, 33);
  assert.deepEqual(locals(s), [
    ['prices', 'ref'],
    ['sum', { k: 'num', v: '21' }],
    ['note', { k: 'str', v: 'expensive' }],
  ]);
  assert.deepEqual(
    top(s).vars.filter((v) => v.scope === 'block'),
    [],
  );
  await stop();
}

async function blocks(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'blocks.ts');
  await debug(api, start, file, [30]);
  const s = await runToLine(api, file, 30);
  const global = s.frames.find((f) => f.name === 'Global scope');
  assert.ok(global, `the Global scope in ${s.frames.map((f) => f.name).join(', ')}`);
  // The block declares a second variable a. The view shows both: the a of the Global scope and the a of the block.
  assert.deepEqual(
    global.vars.filter((v) => v.name === 'a').map((v) => [v.block ?? 0, v.value]),
    [
      [0, { k: 'num', v: '10' }],
      [1, { k: 'num', v: '200' }],
    ],
  );
  // The blocks nest like the braces: the outer block, the header of the for loop, its body, and the if block.
  assert.deepEqual(
    ['c', 'i', 'd', 'e'].map((name) => global.vars.find((v) => v.name === name)?.block),
    [1, 2, 3, 4],
  );
  // Each block scope is named after its statement.
  assert.deepEqual(global.blocks, ['block', 'for', 'for body', 'if']);
  assert.deepEqual(variable(s, 'Global scope', 'e'), { k: 'num', v: '442' });
  // The editor draws a rectangle in the color of its part around each block scope: around the lines between the
  // braces of a block (from 1 here, with the column of the left side), and around the whole for loop.
  assert.deepEqual(
    api.blockMarks(file).map((m) => [m.block, m.kind, m.first + 1, m.last + 1, m.indent]),
    [
      [1, 'block', 24, 38, 2],
      [2, 'for', 26, 32, 2],
      [3, 'for body', 27, 31, 4],
      [4, 'if', 29, 30, 6],
    ],
  );
  // The switch "Show scope frames" turns the rectangles off and on again, and saves its setting.
  const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
  try {
    await api.saveViewOption('showScopeFrames', false);
    assert.deepEqual(api.blockMarks(file), [], 'no rectangles while the switch is off');
    assert.equal(config().inspect('showScopeFrames')?.globalValue, false);
    await api.saveViewOption('showScopeFrames', true);
    assert.equal(api.blockMarks(file).length, 4, 'the rectangles are back when the switch is on');
    assert.equal(config().inspect('showScopeFrames')?.globalValue, undefined, 'the default removes the user setting');
  } finally {
    await config().update('showScopeFrames', undefined, vscode.ConfigurationTarget.Global);
  }
  await stop();
  assert.deepEqual(api.blockMarks(file), [], 'the marks go away when the program ends');
}

async function insertionSort(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'insertion-sort.ts');
  // The breakpoint is not on line 19 (the line after the loop): before the source map of Node.js is loaded, the
  // JavaScript debugger sets a breakpoint on the same line number of the code that Node.js generates from the
  // TypeScript file. There, line 19 is the first statement of the program, so the start of the program hits that
  // breakpoint; the debugger then removes it, resumes, and does not report the pause at the first line (js-debug
  // 1.140, pause reason "ambiguous").
  const entry = await debug(api, start, file, [10]);
  // The program pauses at its first statement, and the runtime's own code is not a frame.
  if (start.pausesAtFirstStatement) {
    assert.deepEqual(
      entry.frames.map((f) => [f.name, f.line, f.file]),
      [['Global scope', 23, file]],
    );
  } else {
    assert.deepEqual(
      entry.frames.map((f) => [f.name, f.file]),
      [['Global scope', file], ['insertionSort', file]],
    );
  }
  // On line 10, unsortedValue and sortedIndex are not declared yet. Two steps lead to line 14, where they have values.
  let s = await runToLine(api, file, 10);
  for (const line of [11, 14]) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('workbench.action.debug.stepOver');
    s = await next;
    assert.equal(top(s)?.line, line);
  }
  assert.deepEqual(
    s.frames.map((f) => f.name),
    ['Global scope', 'insertionSort'],
  );
  // The variables are in the order of the program: the view draws them bottom up, with arr at the bottom.
  assert.deepEqual(
    s.frames[1].vars.map((v) => v.name).filter((n) => n !== 'this'),
    ['arr', 'unsortedIndex', 'unsortedValue', 'sortedIndex'],
  );
  const arr = idOf(variable(s, 'insertionSort', 'arr'));
  assert.equal(idOf(variable(s, 'Global scope', 'arr2')), arr, 'arr and arr2 point to the same array');
  assert.equal(s.objects[arr].kind, 'array');
  assert.equal(s.objects[arr].length, 8);

  const next = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('workbench.action.debug.stepOver');
  const after = await next;
  assert.equal(idOf(variable(after, 'Global scope', 'arr2')), arr, 'the id stays the same after a step');
  assert.ok(after.step > s.step);
  await stop();
}

async function people(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'people.ts');
  await debug(api, start, file, [13, 26, 42, 33]);
  // The frame of a method has the class that declares it; a constructor is "Class.constructor", also when
  // a subclass calls it with super(...).
  const first = await runToLine(api, file, 13);
  const pauses = [first];
  while (top(pauses[pauses.length - 1]).line !== 33) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('workbench.action.debug.continue');
    pauses.push(await next);
    assert.ok(pauses.length <= 6, 'the program did not pause at line 33');
  }
  assert.deepEqual(
    pauses.map((p) => p.frames.map((f) => f.name).join(' > ')),
    [
      'Global scope > Address.constructor',
      'Global scope > Person.constructor',
      'Global scope > Student.constructor > Person.constructor',
      'Global scope > Student.constructor',
      'Global scope > Person.birthday',
    ],
  );
  const s = pauses[pauses.length - 1];
  const ann = s.objects[idOf(variable(s, 'Person.birthday', 'this'))];
  const person = s.objects[ann.cls!];
  assert.equal(person.kind, 'class');
  assert.equal(person.type, 'Person');
  assert.deepEqual(person.fields?.[0], { name: 'count', value: { k: 'num', v: '2' } });
  assert.deepEqual(person.attrs, ['name', 'age', 'home', 'bestFriend']);
  const bob = s.objects[idOf(variable(s, 'Global scope', 'bob'))];
  assert.equal(s.objects[bob.cls!].superId, person.id);

  // An earlier step of the history shows its line in the editor, also when the file is closed.
  await closeTextEditors();
  api.viewStep(first.step);
  await waitForVisibleLine(file, 13);
  api.viewStep(s.step);
  await waitForVisibleLine(file, 33);
  await stop();
}

/**
 * Continues until the program pauses at `line` of `file` again. Other pauses are skipped: with stopOnEntry, the
 * JavaScript debugger can also pause at the first line of a function each time it is called.
 */
async function continueToLine(api: MindbugApi, file: string, line: number): Promise<MemorySnapshot> {
  for (let i = 0; i < 10; i++) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('workbench.action.debug.continue');
    const s = await next;
    if (top(s)?.file === file && top(s)?.line === line) return s;
  }
  throw new Error(`the program did not pause at line ${line} again`);
}

async function callStack(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'call-stack.ts');
  await debug(api, start, file, [61, 69, 80]);
  // In lineTotal, the inner function, four scopes are on the stack, with the newest function call on top. The
  // variables of different scopes point to the same objects on the heap.
  const first = await runToLine(api, file, 61);
  assert.deepEqual(
    first.frames.map((f) => f.name),
    ['Global scope', 'checkout', 'makeBill', 'lineTotal'],
  );
  const cart = idOf(variable(first, 'Global scope', 'cart'));
  assert.equal(idOf(variable(first, 'makeBill', 'items')), cart, 'items in makeBill points to cart');
  assert.equal(idOf(variable(first, 'lineTotal', 'item')), idOf(first.objects[cart].items![0]), 'item points to cart[0]');
  assert.deepEqual(variable(first, 'lineTotal', 'total'), { k: 'num', v: '5.4' });
  const bill = idOf(variable(first, 'makeBill', 'bill'));
  const discount = idOf(variable(first, 'lineTotal', 'discount'));
  // The objects are instances of classes.
  assert.equal(first.objects[cart].items?.length, 2);
  assert.equal(first.objects[idOf(first.objects[cart].items![0])].type, 'Item');
  assert.equal(first.objects[discount].type, 'Discount');
  assert.equal(first.objects[bill].type, 'Bill');
  assert.equal(first.objects[first.objects[bill].cls!].kind, 'class');

  // The object of the inner function does not survive its call: the next call has a new object, and the old object
  // is not on the heap any more. The object of the middle function survives the call of the inner function.
  const second = await continueToLine(api, file, 61);
  assert.notEqual(idOf(variable(second, 'lineTotal', 'discount')), discount, 'the second call creates a new object');
  assert.equal(second.objects[discount], undefined, 'the object of the first call is not on the heap any more');
  assert.equal(idOf(variable(second, 'makeBill', 'bill')), bill, 'the bill of makeBill is the same object');
  assert.deepEqual(second.objects[bill].fields?.find((f) => f.name === 'total')?.value, { k: 'num', v: '5.4' });

  // The object of the middle function also survives the middle function: at the end, bill of the Global scope
  // points to it.
  const made = await continueToLine(api, file, 69);
  assert.deepEqual(
    made.frames.map((f) => f.name),
    ['Global scope', 'checkout', 'makeBill'],
  );
  const end = await continueToLine(api, file, 80);
  assert.deepEqual(
    end.frames.map((f) => f.name),
    ['Global scope'],
  );
  assert.equal(idOf(variable(end, 'Global scope', 'bill')), bill, 'bill of the Global scope points to the object of makeBill');
  await stop();
}

async function innerFunctions(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'inner-functions.ts');
  await debug(api, start, file, [28, 33]);
  // The scope of the inner function is on top of the scope of the outer function. It has its own variables, and the
  // variables of the outer function that it uses, as closure variables: the same variables, not copies.
  const first = await runToLine(api, file, 28);
  assert.deepEqual(
    first.frames.map((f) => f.name),
    ['Global scope', 'receipt', 'addLine'],
  );
  const inner = first.frames.at(-1)!;
  assert.deepEqual(
    inner.vars.map((v) => [v.name, v.scope]),
    [
      ['name', 'local'],
      ['price', 'local'],
      ['withTax', 'local'],
      ['taxRate', 'closure'],
      ['lines', 'closure'],
    ],
    'only the variables of receipt that addLine uses',
  );
  assert.deepEqual(variable(first, 'addLine', 'withTax'), { k: 'num', v: '2.5' });
  const lines = idOf(variable(first, 'receipt', 'lines'));
  assert.equal(idOf(variable(first, 'addLine', 'lines')), lines, 'lines of addLine is the variable of receipt');
  // The second call has its own scope; the array of receipt has the line of the first call.
  const second = await continueToLine(api, file, 28);
  assert.deepEqual(variable(second, 'addLine', 'name'), { k: 'str', v: 'milk' });
  assert.equal(second.objects[lines].items?.length, 2);
  const end = await continueToLine(api, file, 33);
  assert.deepEqual(
    end.frames.map((f) => f.name),
    ['Global scope', 'receipt'],
  );
  assert.deepEqual(variable(end, 'receipt', 'total'), { k: 'num', v: '7.5' });
  await stop();
}

async function closures(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'closures.ts');
  await debug(api, start, file, [29]);
  // The call of makeCounter has ended, but next still has its variables prefix and count: each counter its own.
  const counts: [string, string][] = [];
  for (let i = 0; i < 3; i++) {
    const s = i === 0 ? await runToLine(api, file, 29) : await continueToLine(api, file, 29);
    assert.deepEqual(
      s.frames.map((f) => f.name),
      ['Global scope', 'next'],
      'makeCounter is not on the stack any more',
    );
    const vars = s.frames.at(-1)!.vars;
    assert.deepEqual(
      vars.map((v) => [v.name, v.scope]),
      [
        ['prefix', 'closure'],
        ['count', 'closure'],
      ],
    );
    counts.push([(vars[0].value as { v: string }).v, (vars[1].value as { v: string }).v]);
  }
  assert.deepEqual(counts, [
    ['A', '0'],
    ['A', '1'],
    ['B', '0'],
  ]);
  await stop();
}

/** Runs Step Over or Step Into and returns the snapshot of the next pause. */
async function step(api: MindbugApi, command: 'stepOver' | 'stepInto'): Promise<MemorySnapshot> {
  const next = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand(`workbench.action.debug.${command}`);
  return next;
}

async function returnValues(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'return-object.ts');
  await debug(api, start, file, [24]);
  // At the end of the constructor of Book, the debugger shows a return value (undefined), which the program never
  // gets: `new` gives the new object. The view shows no return value there.
  let s = await runToLine(api, file, 24);
  for (const line of [25, 26]) {
    s = await step(api, 'stepOver');
    assert.equal(top(s)?.line, line);
  }
  assert.equal(top(s).name, 'Book.constructor');
  // Node.js runs the file as a CommonJS module, so there the class Book is also a closure variable of the constructor.
  assert.deepEqual(
    top(s).vars.filter((v) => v.scope === 'local').map((v) => v.name).sort(),
    ['pages', 'this', 'title'],
  );
  // At the return of createBook, the view shows the return value of the function.
  s = await step(api, 'stepOver');
  assert.equal(top(s).name, 'createBook');
  assert.equal(top(s).line, 31);
  assert.ok(top(s).vars.some((v) => v.name === 'Return value'), 'createBook has a return value');
  await stop();
}

async function fieldSetup(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'people.ts');
  await debug(api, start, file, [47]);
  await runToLine(api, file, 47);
  // Step Into new Person(...) pauses in the function of V8 that sets up the field bestFriend. Node.js 22 stopped with
  // a fatal error of V8 when Mindbug evaluated code in that frame; its `this` comes from the constructor.
  const s = await step(api, 'stepInto');
  assert.deepEqual(
    s.frames.map((f) => f.name),
    ['Global scope', 'Person.constructor', 'Person (set up fields)'],
  );
  assert.equal(top(s).line, 23);
  const self = idOf(variable(s, 'Person (set up fields)', 'this'));
  assert.equal(idOf(variable(s, 'Person.constructor', 'this')), self);
  assert.equal(s.objects[self].type, 'Person');
  // The program still runs.
  const next = await step(api, 'stepInto');
  assert.ok(['Person (set up fields)', 'Person.constructor'].includes(top(next).name), top(next).name);
  await stop();
}

async function restart(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'return-object.ts');
  const entry = await debug(api, start, file, []);
  assert.equal(entry.step, 1);
  await step(api, 'stepOver');
  await step(api, 'stepOver');
  assert.deepEqual(api.historySteps(), [1, 2, 3]);
  // A restart runs the program again: the steps of the earlier run go away, and the steps count from 1 again.
  const first = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('workbench.action.debug.restart');
  const again = await first;
  assert.equal(again.step, 1, 'the first pause after the restart is step 1');
  assert.deepEqual(api.historySteps(), [1], 'the history has only the step of the new run');
  // The end of the earlier run, which VS Code can report late, does not stop the new run.
  const next = await step(api, 'stepOver');
  assert.equal(next.step, 2);
  assert.deepEqual(api.historySteps(), [1, 2]);
  await stop();
}

/**
 * A program with variables named t, e, r, n, i and o. VS Code's JavaScript debugger has variables with these names in
 * the function that it builds for an evaluate with the context "clipboard", which hid the variables of the program.
 * The test writes it into the folder of the examples: the JavaScript debugger uses the source maps of the TypeScript
 * files only in the workspace folder, so a breakpoint in a file elsewhere does not stop Node.js.
 */
const NAMES_PROGRAM = `// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

function inner(o: string): string {
  for (let i = 0; i < 2; i++) {
    const r = i * 10;
    const n = { o, r };
    console.log(n);
  }
  return o;
}

function outer(t: string): string {
  const e = t + '!';
  return inner(e);
}

outer('tea');
`;

async function names(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'names-test.ts');
  fs.writeFileSync(file, NAMES_PROGRAM);
  try {
    await debug(api, start, file, [9]);
    const s = await runToLine(api, file, 9);
    assert.deepEqual(
      s.frames.map((f) => f.name),
      ['Global scope', 'outer', 'inner'],
    );
    assert.deepEqual(variable(s, 'outer', 't'), { k: 'str', v: 'tea' });
    assert.deepEqual(variable(s, 'outer', 'e'), { k: 'str', v: 'tea!' });
    assert.deepEqual(variable(s, 'inner', 'o'), { k: 'str', v: 'tea!' });
    assert.deepEqual(variable(s, 'inner', 'i'), { k: 'num', v: '0' });
    assert.deepEqual(variable(s, 'inner', 'r'), { k: 'num', v: '0' });
    const n = s.objects[idOf(variable(s, 'inner', 'n'))];
    assert.deepEqual(n.fields?.map((f) => f.name), ['o', 'r']);
    await stop();
  } finally {
    await closeTextEditors();
    fs.rmSync(file, { force: true });
  }
}

/**
 * A module that exports a class with a static variable. While JavaScript sets up the static variable (line 8), the
 * class `Car` is not initialized yet. V8 can give the debugger an internal empty value for an exported name before its
 * declaration, not a ReferenceError: `typeof` on that value stopped Deno 2.5 with "abort: Unexpected instance type
 * encountered", when Mindbug still ran Deno.
 */
const EXPORTS_PROGRAM = `// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

export const LIMIT = 3;

export class Car {
  static count = 0;
  brand: string;

  constructor(brand: string) {
    Car.count++;
    this.brand = brand;
  }
}

const car = new Car('VW');
debugger;
console.log(car.brand, Car.count, LIMIT);
`;

async function exportsBeforeDeclaration(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'exports-test.ts');
  fs.writeFileSync(file, EXPORTS_PROGRAM);
  try {
    // No breakpoint: a breakpoint can hide the pause at the first statement (see insertionSort). Step Into leads to
    // the set-up of the static variable, and the program pauses again at its `debugger` statement.
    let s = await debug(api, start, file, []);
    for (let i = 0; i < 10 && top(s).name !== 'Car (set up static variables)'; i++) s = await step(api, 'stepInto');
    assert.deepEqual(
      s.frames.map((f) => f.name),
      ['Global scope', 'Car (set up static variables)'],
    );
    assert.equal(top(s).line, 8);
    assert.deepEqual(variable(s, 'Global scope', 'LIMIT'), { k: 'num', v: '3' });
    // V8 lists Car in the Global scope here, with the class itself or with the internal empty value.
    const cls = variable(s, 'Global scope', 'Car');
    if (cls.k !== 'uninit') assert.equal(idOf(cls), idOf(variable(s, 'Car (set up static variables)', 'this')));
    // The program still runs, and the class has its static variable.
    s = await runToLine(api, file, 18);
    const car = s.objects[idOf(variable(s, 'Global scope', 'Car'))];
    assert.equal(car.kind, 'class');
    assert.deepEqual(car.fields?.find((f) => f.name === 'count')?.value, { k: 'num', v: '1' });
    await stop();
  } finally {
    await closeTextEditors();
    fs.rmSync(file, { force: true });
  }
}

/**
 * A program with an enum and a class with constructor parameter properties: TypeScript syntax that is not only types.
 * Node.js 26 only strips types, so Mindbug runs the program with its hooks and the TypeScript compiler of VS Code.
 */
const ENUM_PROGRAM = `// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

enum Size {
  Small,
  Large,
}

class Pizza {
  constructor(
    public name: string,
    private size: Size,
  ) {}

  isLarge(): boolean {
    return this.size === Size.Large;
  }
}

const pizza = new Pizza('Margherita', Size.Large);
debugger;
console.log(pizza.isLarge());
`;

/**
 * Runs ENUM_PROGRAM in the folder of the examples, as a CommonJS module, and in a folder whose package.json has
 * "type": "module", as an ES module, like the programs of a course.
 */
async function enumsAndParameterProperties(api: MindbugApi, start: Start): Promise<void> {
  const module = path.join(examples(), 'module-test');
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(module, 'package.json'), '{ "type": "module" }\n');
  try {
    for (const file of [path.join(examples(), 'enum-test.ts'), path.join(module, 'enum-test.ts')]) {
      fs.writeFileSync(file, ENUM_PROGRAM);
      await debug(api, start, file, []);
      const s = await runToLine(api, file, 22);
      const size = s.objects[idOf(variable(s, 'Global scope', 'Size'))];
      assert.deepEqual(size.fields?.find((f) => f.name === 'Large')?.value, { k: 'num', v: '1' });
      // The constructor parameter properties are fields of the new object.
      const pizza = s.objects[idOf(variable(s, 'Global scope', 'pizza'))];
      assert.equal(pizza.type, 'Pizza');
      assert.deepEqual(
        pizza.fields?.map((f) => [f.name, f.value]),
        [
          ['name', { k: 'str', v: 'Margherita' }],
          ['size', { k: 'num', v: '1' }],
        ],
      );
      await stop();
      await closeTextEditors();
    }
  } finally {
    await closeTextEditors();
    fs.rmSync(path.join(examples(), 'enum-test.ts'), { force: true });
    fs.rmSync(module, { recursive: true, force: true });
  }
}

/**
 * A program whose last line calls console.log, which is code of Node.js. A step must not stop in the code of the
 * runtime, and VS Code must open no file of it (with Deno, a step stopped in ext:runtime_main/js/99_main.js after the
 * last line, when Mindbug still ran Deno).
 */
const END_PROGRAM = `// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

const total = 2 + 3;
console.log(total);
`;

interface DapMessage {
  type: string;
  seq: number;
  command?: string;
  event?: string;
  request_seq?: number;
  arguments?: { startFrame?: number };
  body?: { threadId?: number; stackFrames?: { name: string; source?: { path?: string; name?: string } }[] };
}

/** Records the file of the top frame of each call stack that the JavaScript debugger sends. */
function recordTopFrames(): { files: string[]; dispose(): void } {
  const files: string[] = [];
  const firstFrame = new Set<number>();
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('*', {
    createDebugAdapterTracker: () => ({
      onWillReceiveMessage: (m: DapMessage) => {
        if (m.type === 'request' && m.command === 'stackTrace' && !m.arguments?.startFrame) firstFrame.add(m.seq);
      },
      onDidSendMessage: (m: DapMessage) => {
        if (m.type !== 'response' || m.command !== 'stackTrace' || !firstFrame.delete(m.request_seq ?? -1)) return;
        const frame = m.body?.stackFrames?.[0];
        if (frame) files.push(frame.source?.path ?? frame.source?.name ?? frame.name);
      },
    }),
  });
  return { files, dispose: () => tracker.dispose() };
}

interface Pause {
  session: vscode.DebugSession;
  threadId: number;
}

/**
 * Records the pauses of the programs that start later, also the pauses that Mindbug does not read, and counts the
 * requests `requestCDPProxy`, which only Mindbug sends.
 */
function recordPauses(): { next(): Promise<Pause>; cdpRequests(): number; dispose(): void } {
  const pauses: Pause[] = [];
  const waiters: ((p: Pause) => void)[] = [];
  let cdpRequests = 0;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory('pwa-node', {
    createDebugAdapterTracker: (session) => ({
      onWillReceiveMessage: (m: DapMessage) => {
        if (m.type === 'request' && m.command === 'requestCDPProxy') cdpRequests++;
      },
      onDidSendMessage: (m: DapMessage) => {
        if (m.type !== 'event' || m.event !== 'stopped') return;
        const pause = { session, threadId: m.body?.threadId ?? 1 };
        const waiter = waiters.shift();
        if (waiter) waiter(pause);
        else pauses.push(pause);
      },
    }),
  });
  return {
    next: () => {
      const pause = pauses.shift();
      if (pause) return Promise.resolve(pause);
      return new Promise((resolve, reject) => {
        waiters.push(resolve);
        setTimeout(() => reject(new Error('the program did not pause')), TIMEOUT);
      });
    },
    cdpRequests: () => cdpRequests,
    dispose: () => tracker.dispose(),
  };
}

/** True when the helper of Mindbug is in the paused program: it adds the global `__mindbug`. */
async function hasHelper(pause: Pause): Promise<boolean> {
  const trace = await pause.session.customRequest('stackTrace', { threadId: pause.threadId, startFrame: 0, levels: 1 });
  const frameId = trace?.stackFrames?.[0]?.id;
  assert.equal(typeof frameId, 'number', 'the program is paused');
  const result = await pause.session.customRequest('evaluate', { expression: "'__mindbug' in globalThis", frameId, context: 'watch' });
  return String(result?.result) === 'true';
}

async function closeView(): Promise<void> {
  const tabs = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('nimblescape.mindbug.memory'));
  await vscode.window.tabGroups.close(tabs);
}

/**
 * Mindbug reads the memory of a paused program only while its view is open. A pause while the view is closed gets no
 * request of Mindbug and no helper; the view reads it when it opens. The step history keeps the steps from before.
 */
async function onlyWhileTheViewIsOpen(api: MindbugApi): Promise<void> {
  const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
  const file = path.join(examples(), 'return-object.ts');
  const pauses = recordPauses();
  try {
    await closeView();
    await config().update('openAutomatically', false, vscode.ConfigurationTarget.Global);
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    await vscode.window.showTextDocument(vscode.Uri.file(file));
    const before = api.lastSnapshot();
    const first = pauses.next();
    // A launch configuration of VS Code's JavaScript debugger, which Mindbug did not start.
    assert.ok(await STARTS[STARTS.length - 1].run(file), 'the debug session starts');
    let pause = await first;
    assert.equal(await hasHelper(pause), false, 'no helper in the program while the view is closed');
    assert.equal(pauses.cdpRequests(), 0, 'no connection to V8 while the view is closed');
    assert.equal(api.lastSnapshot(), before, 'no step while the view is closed');

    // The view opens and reads the pause.
    const opened = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('nimblescape.mindbug.open');
    const s = await opened;
    assert.equal(s.step, 1);
    assert.equal(await hasHelper(pause), true, 'the view runs the helper');
    const requests = pauses.cdpRequests();
    assert.ok(requests > 0);

    // The view closes: the next pause gets no request of Mindbug.
    await closeView();
    const second = pauses.next();
    await vscode.commands.executeCommand('workbench.action.debug.stepOver');
    pause = await second;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(api.lastSnapshot(), s, 'no step while the view is closed');
    assert.equal(pauses.cdpRequests(), requests, 'no new connection to V8 while the view is closed');

    // The view opens again: the step history keeps step 1 and reads the pause as step 2.
    const again = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('nimblescape.mindbug.open');
    assert.equal((await again).step, 2);
    assert.deepEqual(api.historySteps(), [1, 2]);
  } finally {
    pauses.dispose();
    await config().update('openAutomatically', true, vscode.ConfigurationTarget.Global);
  }
}

async function stepsToTheEnd(api: MindbugApi, start: Start): Promise<void> {
  const file = path.join(examples(), 'end-test.ts');
  fs.writeFileSync(file, END_PROGRAM);
  // The end of the root session: the debug type "ts" also has child sessions, for the command ts, for tsc and for
  // the program, and the session of tsc ends before the program starts.
  const ended = new Promise<undefined>((resolve) => {
    const d = vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.parentSession) return;
      d.dispose();
      resolve(undefined);
    });
  });
  const topFrames = recordTopFrames();
  try {
    let s: MemorySnapshot | undefined = await debug(api, start, file, []);
    // Step Into on each line, also on console.log, until the program ends.
    const lines: number[] = [];
    for (let i = 0; s; i++) {
      assert.ok(i < 10, `the program ends after a few steps; it paused at the lines ${lines.join(', ')}`);
      lines.push(top(s).line);
      const next = api.nextSnapshot(TIMEOUT);
      next.catch(() => undefined);
      await vscode.commands.executeCommand('workbench.action.debug.stepInto');
      s = await Promise.race([next, ended]);
    }
    assert.ok(lines.includes(6), `the program paused at line 6 (console.log); it paused at the lines ${lines.join(', ')}`);
    // Each pause is in the file of the program, and VS Code opened no file of the runtime.
    assert.deepEqual([...new Set(topFrames.files)], [file]);
    const opened = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .map((t) => t.input)
      .filter((input): input is vscode.TabInputText => input instanceof vscode.TabInputText)
      .map((input) => input.uri);
    assert.deepEqual(
      opened.filter((uri) => uri.scheme !== 'file').map(String),
      [],
    );
  } finally {
    topFrames.dispose();
    await closeTextEditors();
    fs.rmSync(file, { force: true });
  }
}

describe('the Mindbug view in VS Code', () => {
  let api: MindbugApi;

  before(async () => {
    const ext = vscode.extensions.getExtension('nimblescape.nimblescape-mindbug');
    assert.ok(ext, 'the extension is installed');
    api = (await ext.activate()) as MindbugApi;
    await vscode.workspace.getConfiguration('nimblescape.mindbug').update('openAutomatically', true, vscode.ConfigurationTarget.Global);
  });

  afterEach(async () => {
    if (vscode.debug.activeDebugSession) await stop();
  });

  it('saves a switch of the view in the user settings, and removes the setting at the default', async () => {
    const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
    try {
      await api.saveViewOption('showFunctions', true);
      await api.saveViewOption('showClasses', false);
      await api.saveViewOption('showIds', true);
      assert.equal(config().inspect('showFunctions')?.globalValue, true);
      assert.equal(config().inspect('showClasses')?.globalValue, false);
      assert.equal(config().inspect('showIds')?.globalValue, undefined, 'a switch at its default writes no setting');
      await api.saveViewOption('showFunctions', false);
      assert.equal(config().inspect('showFunctions')?.globalValue, undefined, 'the default removes the user setting');
    } finally {
      for (const name of ['showFunctions', 'showClasses', 'showIds', 'showUninitialized', 'showScopeFrames', 'stopOnEntry']) {
        await config().update(name, undefined, vscode.ConfigurationTarget.Global);
      }
    }
  });

  it('saves the clicks on the switches in their order, so that the last click wins', async () => {
    const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
    try {
      await Promise.all([
        api.saveViewOption('showFunctions', true),
        api.saveViewOption('showClasses', false),
        api.saveViewOption('showFunctions', false),
        api.saveViewOption('showFunctions', true),
      ]);
      assert.equal(config().inspect('showFunctions')?.globalValue, true);
      assert.equal(config().inspect('showClasses')?.globalValue, false);
    } finally {
      for (const name of ['showFunctions', 'showClasses']) await config().update(name, undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('starts a program without a pause at its first line when the switch "Stop on entry" is off', async () => {
    const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
    const file = path.join(examples(), 'blocks.ts');
    try {
      await api.saveViewOption('stopOnEntry', false);
      assert.equal(config().inspect('stopOnEntry')?.globalValue, false);
      vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
      const uri = vscode.Uri.file(file);
      vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(29, 0)))]);
      await vscode.window.showTextDocument(uri);
      const first = api.nextSnapshot(TIMEOUT);
      assert.ok(await runWithMindbug(file), 'the debug session starts');
      const s = await first;
      assert.equal(top(s)?.line, 30, 'the first pause is the breakpoint');
    } finally {
      vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
      await config().update('stopOnEntry', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('does not start a launch configuration with "runtime": "deno" of Mindbug 0.1', async () => {
    const sessions: vscode.DebugSession[] = [];
    const started = vscode.debug.onDidStartDebugSession((s) => sessions.push(s));
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(examples(), 'people.ts')));
      const ok = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'mindbug',
        request: 'launch',
        name: 'Mindbug: Deno',
        program: '${file}',
        runtime: 'deno',
      });
      assert.equal(ok, false);
      assert.deepEqual(sessions, []);
    } finally {
      started.dispose();
      await closeTextEditors();
    }
  });

  it('does not change the settings of the workspace when they set a switch', async () => {
    const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
    const settings = vscode.Uri.file(path.join(examples(), '.vscode', 'settings.json'));
    const existed = await Promise.resolve(vscode.workspace.fs.stat(settings)).then(() => true, () => false);
    await config().update('showIds', false, vscode.ConfigurationTarget.Workspace);
    try {
      await api.saveViewOption('showIds', true);
      assert.equal(config().inspect('showIds')?.workspaceValue, false, 'the setting of the workspace stays');
      assert.equal(config().inspect('showIds')?.globalValue, undefined, 'no user setting');
    } finally {
      await config().update('showIds', undefined, vscode.ConfigurationTarget.Workspace);
      if (!existed) await vscode.workspace.fs.delete(settings);
    }
  });

  it('reads the memory of a paused program only while the view is open', () => onlyWhileTheViewIsOpen(api));

  for (const start of STARTS) {
    describe(start.title, () => {
      it('shows the scopes, the arrays and the aliasing of insertion sort', () => insertionSort(api, start));
      it('shows classes, static variables and the scopes of constructors and methods', () => people(api, start));
      it('shows a call stack of several functions that share the objects on the heap', () => callStack(api, start));
      it('shows the variables of an outer function that an inner function uses', () => innerFunctions(api, start));
      it('shows the variables of a closure after the call of its outer function', () => closures(api, start));
      it('shows no return value in a constructor, and the return value of a function', () => returnValues(api, start));
      it('steps into the set-up of the fields of a new object', () => fieldSetup(api, start));
      it('starts a new step history when the debug session restarts', () => restart(api, start));
      it('reads the variables named t, e, r, n, i and o', () => names(api, start));
      it('steps into the set-up of the static variable of an exported class', () => exportsBeforeDeclaration(api, start));
      it('shows the variables of each scope in the order of the program', () => variableOrder(api, start));
      it('shows a var and a let before their lines, and a var in a block', () => varAndLet(api, start));
      it('shows the variables of each block, also a variable that hides one of the same name', () => blocks(api, start));
      it('does not stop in the code of the runtime: a step after the last line ends the program', () =>
        stepsToTheEnd(api, start));
      // An own launch configuration of type "node" runs Node.js without the command ts, and Node.js only strips the
      // types.
      if (start.compiles) {
        it('runs enums and constructor parameter properties', () => enumsAndParameterProperties(api, start));
      }
    });
  }
});
