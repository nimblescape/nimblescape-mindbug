// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The driver of the animation of the README (record.ts). record.ts packs this file as a small extension and installs
// it next to the Mindbug package into a separate VS Code. When that VS Code starts with MINDBUG_GIF_FRAMES set, the
// driver opens examples/return-object.ts, starts it with "Run with Mindbug", and steps through it like a student with
// Step Into and Step Over. Then it goes back through the step history, as the button ‹ of the view does. After each
// action it waits until the view shows the step, saves a screenshot of the whole screen with ffmpeg into the folder
// MINDBUG_GIF_FRAMES, and writes the caption of the action next to it. Then it closes VS Code.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MindbugApi } from '../../src/extension.ts';
import type { MemorySnapshot } from '../../src/model.ts';

const TIMEOUT = 60000;

/** The line of the first pause, and its caption. */
const START = { line: 34, caption: 'Click Run with Mindbug. The program pauses, and the view opens.' };
/** The steps after the first pause: the command of the debugger, the line of the next pause, and the caption. */
const STEPS = [
  { command: 'stepInto', line: 30, caption: 'Press F11 (Step Into). The call adds a scope with title and pages.' },
  { command: 'stepOver', line: 31, caption: 'Press F10 (Step Over). new Book creates an object on the heap.' },
  { command: 'stepOver', line: 35, caption: 'Press F10. createBook returns, and myBook points to the object.' },
  { command: 'stepOver', line: 36, caption: 'Press F10. console.log reads the object.' },
  { command: 'stepOver', line: 37, caption: 'Press F10. After myBook = null, the object is gone.' },
];
/** The steps that the step history shows again, from the newest to the oldest, and their captions. */
const REPLAY = [
  { step: 5, caption: 'Click ‹ in the step history. The view shows step 5 again.' },
  { step: 4, caption: 'Click ‹. The view shows step 4.' },
  { step: 3, caption: 'Click ‹. Step 3: book points to the new object.' },
  { step: 2, caption: 'Click ‹. Step 2: the object does not exist yet.' },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function top(s: MemorySnapshot) {
  return s.frames[s.frames.length - 1];
}

/** Saves a screenshot of the X display of VS Code (Xvfb under Linux) as <name>.png, and its caption as <name>.txt. */
async function screenshot(frames: string, name: string, caption: string): Promise<void> {
  // The time for the view to draw the step, and for the editor to mark the line.
  await vscode.commands.executeCommand('notifications.clearAll');
  await sleep(2000);
  const display = process.env.DISPLAY ?? ':0';
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-i', display, '-frames:v', '1', '-y', path.join(frames, `${name}.png`)]);
  writeFileSync(path.join(frames, `${name}.txt`), caption);
}

async function pausesAt(next: Promise<MemorySnapshot>, line: number): Promise<void> {
  const s = await next;
  if (top(s)?.line !== line) throw new Error(`the program paused at line ${top(s)?.line}, not at line ${line}`);
}

async function record(frames: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('VS Code opened no folder');
  const file = vscode.Uri.file(path.join(folder.uri.fsPath, 'return-object.ts'));
  const api = await vscode.extensions.getExtension<MindbugApi>('nimblescape.nimblescape-mindbug')?.activate();
  if (!api) throw new Error('the Mindbug extension is not installed');

  // Only the editor: no side bar and no panel.
  await vscode.window.showTextDocument(file);
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('workbench.action.closePanel');
  // The time for the TypeScript extension to color the code.
  await sleep(4000);
  await screenshot(frames, '00-editor', 'Open the file return-object.ts.');

  const first = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('nimblescape.mindbug.run', file);
  await pausesAt(first, START.line);
  // The view opens beside the editor. It gets more of the width than the code.
  await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.4 }, { size: 0.6 }] });
  let frame = 1;
  const name = (action: string) => `${String(frame++).padStart(2, '0')}-${action}`;
  await screenshot(frames, name('start'), START.caption);

  for (const step of STEPS) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand(`workbench.action.debug.${step.command}`);
    await pausesAt(next, step.line);
    await screenshot(frames, name(step.command), step.caption);
  }
  // The same function of the view as the button ‹ and the step list: the view and the editor show the step.
  for (const replay of REPLAY) {
    api.viewStep(replay.step);
    await screenshot(frames, name(`step-${replay.step}`), replay.caption);
  }
  await vscode.debug.stopDebugging();
}

export async function activate(): Promise<void> {
  const frames = process.env.MINDBUG_GIF_FRAMES;
  if (!frames) return;
  try {
    await record(frames);
    writeFileSync(path.join(frames, 'done'), '');
  } catch (e) {
    writeFileSync(path.join(frames, 'error.txt'), e instanceof Error ? (e.stack ?? e.message) : String(e));
  } finally {
    await vscode.commands.executeCommand('workbench.action.quit');
  }
}
