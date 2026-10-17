// Command "Heap Stack: Debug Current File with Deno".
// It starts VS Code's built-in JavaScript debugger with Deno as the runtime,
// so students do not need to write a launch.json file.

import * as path from 'node:path';
import * as vscode from 'vscode';

export interface DenoLaunchSettings {
  denoPath: string;
  port: number;
  stopOnEntry: boolean;
}

/** The debug configuration for one TypeScript file. Same shape as the Deno documentation recommends. */
export function denoDebugConfiguration(file: string, cwd: string, s: DenoLaunchSettings): vscode.DebugConfiguration {
  const inspectFlag = s.stopOnEntry ? '--inspect-brk' : '--inspect-wait';
  return {
    type: 'node',
    request: 'launch',
    name: `Heap Stack: ${path.basename(file)}`,
    program: file,
    cwd,
    runtimeExecutable: s.denoPath,
    runtimeArgs: ['run', `${inspectFlag}=127.0.0.1:${s.port}`, '--allow-all'],
    attachSimplePort: s.port,
    stopOnEntry: s.stopOnEntry,
    console: 'internalConsole',
    outputCapture: 'std',
    skipFiles: ['<node_internals>/**'],
  };
}

export function readLaunchSettings(): DenoLaunchSettings {
  const c = vscode.workspace.getConfiguration('heapStack');
  return {
    denoPath: c.get<string>('denoPath', 'deno') || 'deno',
    port: c.get<number>('inspectPort', 9229),
    stopOnEntry: c.get<boolean>('stopOnEntry', true),
  };
}

export async function debugCurrentFileWithDeno(resource?: vscode.Uri): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  const uri = resource instanceof vscode.Uri ? resource : editor?.document.uri;
  if (!uri || uri.scheme !== 'file') {
    void vscode.window.showErrorMessage('Open a TypeScript file first, then run "Debug Current File with Deno" again.');
    return false;
  }
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (doc?.isDirty) await doc.save();

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(uri.fsPath);
  const config = denoDebugConfiguration(uri.fsPath, cwd, readLaunchSettings());
  const started = await vscode.debug.startDebugging(folder, config);
  if (!started) {
    void vscode.window.showErrorMessage(
      'The debugger did not start. Check that Deno is installed and that the setting "heapStack.denoPath" points to it.',
    );
  }
  return started;
}
