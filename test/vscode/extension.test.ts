/// <reference types="mocha" />
// Tests in a real VS Code (npm run test:vscode, .vscode-test.mjs): mocha runs them in the extension host. They debug
// the example programs with Deno through VS Code's built-in JavaScript debugger and check the snapshots of the
// extension.

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { HeapStackApi } from '../../src/extension.ts';
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
async function runToLine(api: HeapStackApi, file: string, line: number): Promise<MemorySnapshot> {
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

async function debug(api: HeapStackApi, file: string, breakpointLines: number[]): Promise<void> {
  const uri = vscode.Uri.file(file);
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  vscode.debug.addBreakpoints(
    breakpointLines.map((l) => new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(l - 1, 0)))),
  );
  await vscode.window.showTextDocument(uri);
  const first = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('heapStack.debugWithDeno', uri);
  await first;
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

async function insertionSort(api: HeapStackApi): Promise<void> {
  const file = path.join(examples(), 'insertion-sort.ts');
  await debug(api, file, [15]);
  const s = await runToLine(api, file, 15);
  assert.deepEqual(
    s.frames.map((f) => f.name),
    ['Global frame', 'insertionSort'],
  );
  const arr = idOf(variable(s, 'insertionSort', 'arr'));
  assert.equal(idOf(variable(s, 'Global frame', 'arr2')), arr, 'arr and arr2 point to the same array');
  assert.equal(s.objects[arr].kind, 'array');
  assert.equal(s.objects[arr].length, 8);

  const next = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('workbench.action.debug.stepOver');
  const after = await next;
  assert.equal(idOf(variable(after, 'Global frame', 'arr2')), arr, 'the id stays the same after a step');
  assert.ok(after.step > s.step);
  await stop();
}

async function people(api: HeapStackApi): Promise<void> {
  const file = path.join(examples(), 'people.ts');
  await debug(api, file, [9, 22, 38, 29]);
  // The frame of a method has the class that declares it; a constructor is "Class.constructor", also when
  // a subclass calls it with super(...).
  const first = await runToLine(api, file, 9);
  const pauses = [first];
  while (top(pauses[pauses.length - 1]).line !== 29) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand('workbench.action.debug.continue');
    pauses.push(await next);
    assert.ok(pauses.length <= 6, 'the program did not pause at line 29');
  }
  assert.deepEqual(
    pauses.map((p) => p.frames.map((f) => f.name).join(' > ')),
    [
      'Global frame > Address.constructor',
      'Global frame > Person.constructor',
      'Global frame > Student.constructor > Person.constructor',
      'Global frame > Student.constructor',
      'Global frame > Person.birthday',
    ],
  );
  const s = pauses[pauses.length - 1];
  const ann = s.objects[idOf(variable(s, 'Person.birthday', 'this'))];
  const person = s.objects[ann.cls!];
  assert.equal(person.kind, 'class');
  assert.equal(person.type, 'Person');
  assert.deepEqual(person.fields?.[0], { name: 'count', value: { k: 'num', v: '2' } });
  assert.deepEqual(person.attrs, ['name', 'age', 'home', 'bestFriend']);
  const bob = s.objects[idOf(variable(s, 'Global frame', 'bob'))];
  assert.equal(s.objects[bob.cls!].superId, person.id);
  await stop();
}

describe('the memory view in VS Code', () => {
  let api: HeapStackApi;

  before(async () => {
    const ext = vscode.extensions.getExtension('nimblescape.heap-stack');
    assert.ok(ext, 'the extension is installed');
    api = (await ext.activate()) as HeapStackApi;
    await vscode.workspace.getConfiguration('heapStack').update('openAutomatically', true, vscode.ConfigurationTarget.Global);
  });

  afterEach(async () => {
    if (vscode.debug.activeDebugSession) await stop();
  });

  it('shows the frames, the arrays and the aliasing of insertion sort', () => insertionSort(api));
  it('shows classes, static variables and the frames of constructors and methods', () => people(api));
});
