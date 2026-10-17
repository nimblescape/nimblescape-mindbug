// Entry point of the heap-stack extension.

import * as vscode from 'vscode';
import { MemoryController } from './controller.ts';
import { debugCurrentFileWithDeno } from './denoLaunch.ts';
import type { MemorySnapshot } from './model.ts';

export interface HeapStackApi {
  /** The newest snapshot (used by the tests in VS Code, test/vscode). */
  lastSnapshot(): MemorySnapshot | undefined;
  /** Resolves with the next snapshot (used by the tests in VS Code, test/vscode). */
  nextSnapshot(timeoutMs?: number): Promise<MemorySnapshot>;
}

export function activate(context: vscode.ExtensionContext): HeapStackApi {
  const controller = new MemoryController(context.extensionUri);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('heapStack.open', () => controller.open()),
    vscode.commands.registerCommand('heapStack.debugWithDeno', async (resource?: vscode.Uri) => {
      const started = await debugCurrentFileWithDeno(resource);
      if (started) controller.open();
    }),
  );
  return {
    lastSnapshot: () => controller.lastSnapshot,
    nextSnapshot: (timeoutMs) => controller.nextSnapshot(timeoutMs),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
