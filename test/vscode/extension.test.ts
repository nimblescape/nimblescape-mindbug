/// <reference types="mocha" />
// Tests in a real VS Code (npm run test:vscode, .vscode-test.mjs): mocha runs them in the extension host. They debug
// the example programs with Deno through VS Code's built-in JavaScript debugger and check the snapshots of the
// extension.

import * as assert from 'node:assert/strict';
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

/** Starts "Run with Mindbug" for `file` and returns the snapshot of the first pause (stop on entry). */
async function debug(api: MindbugApi, file: string, breakpointLines: number[]): Promise<MemorySnapshot> {
  const uri = vscode.Uri.file(file);
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  vscode.debug.addBreakpoints(
    breakpointLines.map((l) => new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(l - 1, 0)))),
  );
  await vscode.window.showTextDocument(uri);
  const first = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('nimblescape.mindbug.run', uri);
  return first;
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

async function insertionSort(api: MindbugApi): Promise<void> {
  const file = path.join(examples(), 'insertion-sort.ts');
  const entry = await debug(api, file, [15]);
  // The program pauses at its first statement, and Deno's own code is not a frame.
  assert.deepEqual(
    entry.frames.map((f) => [f.name, f.line, f.file]),
    [['Global scope', 19, file]],
  );
  const s = await runToLine(api, file, 15);
  assert.deepEqual(
    s.frames.map((f) => f.name),
    ['Global scope', 'insertionSort'],
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

async function people(api: MindbugApi): Promise<void> {
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
  await waitForVisibleLine(file, 9);
  api.viewStep(s.step);
  await waitForVisibleLine(file, 29);
  await stop();
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

  it('shows the scopes, the arrays and the aliasing of insertion sort', () => insertionSort(api));
  it('shows classes, static variables and the scopes of constructors and methods', () => people(api));
});
