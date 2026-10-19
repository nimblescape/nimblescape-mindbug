// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Entry point of the Mindbug extension.

import * as vscode from 'vscode';
import { MemoryController } from './controller.ts';
import { DEBUG_TYPE, MindbugConfigurationProvider, runWithMindbug } from './launch.ts';
import type { MemorySnapshot, ViewOptions } from './model.ts';

export interface MindbugApi {
  /** The newest snapshot (used by the tests in VS Code, test/vscode). */
  lastSnapshot(): MemorySnapshot | undefined;
  /** Resolves with the next snapshot (used by the tests in VS Code, test/vscode). */
  nextSnapshot(timeoutMs?: number): Promise<MemorySnapshot>;
  /** The step numbers of the step history (used by the tests in VS Code, test/vscode). */
  historySteps(): number[];
  /** Shows a step as the step list of the panel does (used by the tests in VS Code, test/vscode). */
  viewStep(step: number): void;
  /** Saves a switch of the view as a click on it in the panel does (used by the tests in VS Code, test/vscode). */
  saveViewOption(name: keyof ViewOptions, value: boolean): Promise<void>;
}

export function activate(context: vscode.ExtensionContext): MindbugApi {
  const controller = new MemoryController(context.extensionUri);
  context.subscriptions.push(
    controller,
    // Dynamic: the configuration of the current file is in the list of "Run and Debug", also without launch.json.
    vscode.debug.registerDebugConfigurationProvider(
      DEBUG_TYPE,
      new MindbugConfigurationProvider(),
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
    vscode.commands.registerCommand('nimblescape.mindbug.open', () => controller.open()),
    vscode.commands.registerCommand('nimblescape.mindbug.run', async (resource?: vscode.Uri) => {
      const started = await runWithMindbug(resource);
      if (started) controller.open();
      return started;
    }),
  );
  return {
    lastSnapshot: () => controller.lastSnapshot,
    nextSnapshot: (timeoutMs) => controller.nextSnapshot(timeoutMs),
    historySteps: () => controller.historySteps(),
    viewStep: (step) => controller.viewStep(step),
    saveViewOption: (name, value) => controller.saveViewOption(name, value),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
