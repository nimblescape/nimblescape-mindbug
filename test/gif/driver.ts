// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The driver of the animation of the README (record.ts). record.ts packs this file as a small extension and installs
// it next to the Mindbug package into a separate VS Code. When that VS Code starts with MINDBUG_GIF_FRAMES set, the
// driver opens examples/return-object.ts, starts it with "Run with Mindbug", and steps through it like a student with
// Step Into and Step Over. After the start and after each step it waits until the view shows the new step, and saves a
// screenshot of the whole screen with ffmpeg into the folder MINDBUG_GIF_FRAMES. Then it closes VS Code.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MindbugApi } from '../../src/extension.ts';
import type { MemorySnapshot } from '../../src/model.ts';

const TIMEOUT = 60000;

/** The line of the first pause, and the steps after it: the command of the debugger and the line of the next pause. */
const START_LINE = 34;
const STEPS = [
  // The call of createBook adds its scope, with the parameters title and pages.
  { command: 'stepInto', line: 30 },
  // new Book(...) creates the object on the heap, and the local variable book points to it.
  { command: 'stepOver', line: 31 },
  // createBook returns: its scope goes away, and myBook points to the object.
  { command: 'stepOver', line: 35 },
  { command: 'stepOver', line: 36 },
  // myBook = null: no variable points to the object, so the view does not show it any more.
  { command: 'stepOver', line: 37 },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function top(s: MemorySnapshot) {
  return s.frames[s.frames.length - 1];
}

/** Saves a screenshot of the X display of VS Code (Xvfb under Linux). */
async function screenshot(frames: string, name: string): Promise<void> {
  // The time for the view to draw the step, and for the editor to mark the line.
  await vscode.commands.executeCommand('notifications.clearAll');
  await sleep(2000);
  const display = process.env.DISPLAY ?? ':0';
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-i', display, '-frames:v', '1', '-y', path.join(frames, `${name}.png`)]);
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
  await screenshot(frames, '00-editor');

  const first = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('nimblescape.mindbug.run', file);
  await pausesAt(first, START_LINE);
  // The view opens beside the editor. It gets more of the width than the code.
  await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.4 }, { size: 0.6 }] });
  await screenshot(frames, '01-start');

  for (const [i, step] of STEPS.entries()) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand(`workbench.action.debug.${step.command}`);
    await pausesAt(next, step.line);
    await screenshot(frames, `${String(i + 2).padStart(2, '0')}-${step.command}`);
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
