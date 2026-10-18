// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The driver of the animation of the README (record.ts). record.ts packs this file as a small extension and installs
// it next to the Mindbug package into a separate VS Code. When that VS Code starts with MINDBUG_GIF_FRAMES set, the
// driver opens examples/return-object.ts, starts it with F5 (the launch configuration "Mindbug: current file" of
// examples/.vscode/launch.json), and steps through it like a student with Step Into and Step Over. Then it goes back
// through the step history, as the Left arrow key of the view does. After each action it waits until the view shows
// the step, saves a screenshot of the whole screen with ffmpeg into the folder MINDBUG_GIF_FRAMES, and writes the
// captions of the screenshot next to it: <name>.band.txt with the scene, and <name>.key.txt with the pressed key. Then
// it closes VS Code.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MindbugApi } from '../../src/extension.ts';
import type { MemorySnapshot } from '../../src/model.ts';

const TIMEOUT = 60000;

/**
 * The captions, as in the GIF of the README of nimblescape-plantuml: the scenes of the animation, each with its caption
 * in the band above the window, and a label with the key and its command after each key press.
 */
const SCENES = [
  'Start the program: Mindbug shows the stack and the heap next to the code',
  'A function call adds a scope with its parameters, and new adds an object to the heap',
  'The object stays after the return, until no variable points to it',
  'The step history shows the memory as it was at each earlier step',
];
const KEYS = {
  start: 'F5     Start Debugging',
  stepInto: 'F11     Step Into',
  stepOver: 'F10     Step Over',
  earlier: 'Left arrow     Show the earlier step',
};

/**
 * The place of the check box "Show classes" on the screen. The check boxes are at the right end of the toolbar of the
 * view, so the place depends on the width and the zoom of the window, not on the split between the code and the view,
 * as long as the toolbar has one line. Check the GIF after a change: when the click misses, it shows the classes.
 */
const SHOW_CLASSES = { x: 1008, y: 101 };

/** The line of the first pause. */
const START = { line: 34, scene: 1 };
/** The steps after the first pause: the command of the debugger, the line of the next pause, and the scene. */
const STEPS = [
  { command: 'stepInto', line: 30, scene: 2 },
  { command: 'stepOver', line: 31, scene: 2 },
  { command: 'stepOver', line: 35, scene: 3 },
  { command: 'stepOver', line: 36, scene: 3 },
  { command: 'stepOver', line: 37, scene: 3 },
] as const;
/** The steps that the step history shows again, from the newest to the oldest. */
const REPLAY = { steps: [5, 4, 3, 2], scene: 4 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function top(s: MemorySnapshot) {
  return s.frames[s.frames.length - 1];
}

/**
 * Saves a screenshot of the X display of VS Code (Xvfb under Linux) as <name>.png, the number and the caption of its
 * scene as <name>.band.txt, and the label of the pressed key, if there is one, as <name>.key.txt.
 */
async function screenshot(frames: string, name: string, scene: number, key?: string): Promise<void> {
  // The time for the view to draw the step, and for the editor to mark the line.
  await vscode.commands.executeCommand('notifications.clearAll');
  await sleep(2000);
  const display = process.env.DISPLAY ?? ':0';
  execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'x11grab', '-draw_mouse', '0', '-i', display, '-frames:v', '1', '-y', path.join(frames, `${name}.png`)]);
  writeFileSync(path.join(frames, `${name}.band.txt`), `${scene}/${SCENES.length}  ${SCENES[scene - 1]}`);
  if (key) writeFileSync(path.join(frames, `${name}.key.txt`), key);
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
  await screenshot(frames, '00-editor', START.scene);

  // F5 starts the selected launch configuration: the first one of launch.json, "Mindbug: current file".
  const first = api.nextSnapshot(TIMEOUT);
  await vscode.commands.executeCommand('workbench.action.debug.start');
  await pausesAt(first, START.line);
  // The view opens beside the editor. It gets more of the width than the code, and the code keeps room for the lines
  // that the GIF shows. With more width for the code, the toolbar of the view needs two lines.
  await vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.47 }, { size: 0.53 }] });
  // At 120 % in the window of 1440 x 816 pixels, the heap has no room for the classes and the objects. A click on the
  // check box "Show classes" of the view (xdotool) turns the classes off, so that the heap shows the objects. Then the
  // pointer goes below the last line of the code, where it shows no hover, and the code gets the focus again.
  await sleep(1500);
  const { x, y } = SHOW_CLASSES;
  execFileSync('xdotool', ['mousemove', String(x), String(y), 'click', '1', 'mousemove', '300', '700']);
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  let frame = 1;
  const name = (action: string) => `${String(frame++).padStart(2, '0')}-${action}`;
  await screenshot(frames, name('start'), START.scene, KEYS.start);

  for (const step of STEPS) {
    const next = api.nextSnapshot(TIMEOUT);
    await vscode.commands.executeCommand(`workbench.action.debug.${step.command}`);
    await pausesAt(next, step.line);
    await screenshot(frames, name(step.command), step.scene, KEYS[step.command]);
  }
  // The same function of the view as the Left arrow key, the button ‹ and the step list: the view and the editor show
  // the step.
  for (const step of REPLAY.steps) {
    api.viewStep(step);
    await screenshot(frames, name(`step-${step}`), REPLAY.scene, KEYS.earlier);
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
