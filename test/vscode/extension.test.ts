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
 * A way to start a program: the command "Run with Mindbug" with a runtime, a launch configuration of type "mindbug",
 * or an own launch configuration of VS Code's JavaScript debugger.
 */
interface Start {
  title: string;
  run(file: string): Thenable<unknown>;
  /** True when the first pause is at the first statement of the program. */
  pausesAtFirstStatement: boolean;
  /** The runtime that Mindbug must start, for the starts through the debug type "mindbug". */
  runtime?: 'node' | 'deno';
}

async function setRuntime(runtime: 'node' | 'deno'): Promise<void> {
  await vscode.workspace.getConfiguration('nimblescape.mindbug').update('runtime', runtime, vscode.ConfigurationTarget.Global);
}

async function runWithMindbug(runtime: 'node' | 'deno', file: string): Promise<boolean | undefined> {
  await setRuntime(runtime);
  return vscode.commands.executeCommand<boolean>('nimblescape.mindbug.run', vscode.Uri.file(file));
}

const STARTS: Start[] = [
  { title: 'Run with Mindbug, Deno', run: (file) => runWithMindbug('deno', file), pausesAtFirstStatement: true, runtime: 'deno' },
  { title: 'Run with Mindbug, Node.js', run: (file) => runWithMindbug('node', file), pausesAtFirstStatement: true, runtime: 'node' },
  {
    // A launch.json configuration of type "mindbug" for the file of the active editor. Its attribute "runtime" wins
    // over the setting.
    title: 'launch configuration of type "mindbug", Deno',
    pausesAtFirstStatement: true,
    runtime: 'deno',
    run: async () => {
      await setRuntime('node');
      return vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
        type: 'mindbug',
        request: 'launch',
        name: 'Mindbug: current file',
        program: '${file}',
        runtime: 'deno',
      });
    },
  },
  {
    // What a student writes in launch.json: nothing in it is about Mindbug. Node.js comes from the PATH.
    // With stopOnEntry, the debugger stops at the first line of the file that can stop, which can be inside a function.
    title: 'own launch configuration, Node.js',
    pausesAtFirstStatement: false,
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
    if (start.runtime) {
      // The debug type "mindbug" becomes a configuration of VS Code's JavaScript debugger for the runtime.
      const config = sessions[0]?.configuration;
      assert.equal(sessions[0]?.type, 'pwa-node');
      assert.equal(config?.runtimeExecutable, start.runtime);
      assert.equal(config?.program, file);
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
    const d = vscode.debug.onDidTerminateDebugSession(() => {
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
 * files only in the workspace folder, so a breakpoint in a file elsewhere does not stop Deno or Node.js.
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
 * class `Car` is not initialized yet. Deno lists the name `Car` there, and V8 gives the debugger an internal empty
 * value for an exported name before its declaration, not a ReferenceError: `typeof` on that value stopped Deno with
 * "abort: Unexpected instance type encountered".
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
    // No breakpoint: with Deno, a breakpoint hid the pause at the first statement (see insertionSort). Step Into
    // leads to the set-up of the static variable, and the program pauses again at its `debugger` statement.
    let s = await debug(api, start, file, []);
    for (let i = 0; i < 10 && top(s).name !== 'Car (set up static variables)'; i++) s = await step(api, 'stepInto');
    assert.deepEqual(
      s.frames.map((f) => f.name),
      ['Global scope', 'Car (set up static variables)'],
    );
    assert.equal(top(s).line, 8);
    assert.deepEqual(variable(s, 'Global scope', 'LIMIT'), { k: 'num', v: '3' });
    // Deno 2.5 and newer (CI: 2.9.7) list Car in the Global scope here, and reading it stopped Deno. Deno 2.0 to 2.4
    // and Node.js do not list it.
    const cls = s.frames[0].vars.find((v) => v.name === 'Car');
    if (cls) assert.deepEqual(cls.value, { k: 'uninit' });
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
      for (const name of ['showFunctions', 'showClasses', 'showIds']) await config().update(name, undefined, vscode.ConfigurationTarget.Global);
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

  for (const start of STARTS) {
    describe(start.title, () => {
      it('shows the scopes, the arrays and the aliasing of insertion sort', () => insertionSort(api, start));
      it('shows classes, static variables and the scopes of constructors and methods', () => people(api, start));
      it('shows a call stack of several functions that share the objects on the heap', () => callStack(api, start));
      it('shows no return value in a constructor, and the return value of a function', () => returnValues(api, start));
      it('steps into the set-up of the fields of a new object', () => fieldSetup(api, start));
      it('starts a new step history when the debug session restarts', () => restart(api, start));
      it('reads the variables named t, e, r, n, i and o', () => names(api, start));
      it('steps into the set-up of the static variable of an exported class', () => exportsBeforeDeclaration(api, start));
      it('shows the variables of each scope in the order of the program', () => variableOrder(api, start));
    });
  }
});
