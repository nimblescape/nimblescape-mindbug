// Command "Run with Mindbug".
// It starts VS Code's built-in JavaScript debugger for the current file with Deno or Node.js (runtime.ts), so students
// do not need to write a launch.json file. The setting "nimblescape.mindbug.runtime" chooses the runtime; with "auto"
// the command takes Deno when it is installed, else Node.js.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { chooseRuntime, debugConfiguration, MIN_NODE, type LaunchSettings } from './runtime.ts';

export function readLaunchSettings(): LaunchSettings {
  const c = vscode.workspace.getConfiguration('nimblescape.mindbug');
  const runtime = c.get<string>('runtime', 'auto');
  return {
    runtime: runtime === 'deno' || runtime === 'node' ? runtime : 'auto',
    denoPath: c.get<string>('denoPath', 'deno') || 'deno',
    nodePath: c.get<string>('nodePath', 'node') || 'node',
    port: c.get<number>('inspectPort', 9229),
    stopOnEntry: c.get<boolean>('stopOnEntry', true),
  };
}

export async function runWithMindbug(resource?: vscode.Uri): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  const uri = resource instanceof vscode.Uri ? resource : editor?.document.uri;
  if (!uri || uri.scheme !== 'file') {
    void vscode.window.showErrorMessage('Open a TypeScript file first, then run "Run with Mindbug" again.');
    return false;
  }
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (doc?.isDirty) await doc.save();

  const settings = readLaunchSettings();
  const runtime = await chooseRuntime(settings);
  if (!runtime) {
    void vscode.window.showErrorMessage(
      `"Run with Mindbug" needs Deno or Node.js ${MIN_NODE.join('.')} or newer, and found neither. Install one of them, ` +
        'or set "nimblescape.mindbug.denoPath" or "nimblescape.mindbug.nodePath". You can also start your own launch configuration.',
    );
    return false;
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const cwd = folder?.uri.fsPath ?? path.dirname(uri.fsPath);
  const started = await vscode.debug.startDebugging(folder, debugConfiguration(uri.fsPath, cwd, runtime, settings));
  if (!started) {
    void vscode.window.showErrorMessage(
      runtime === 'deno'
        ? 'The debugger did not start. Check that Deno is installed and that the setting "nimblescape.mindbug.denoPath" points to it.'
        : `The debugger did not start. Check that Node.js ${MIN_NODE.join('.')} or newer is installed and that the setting "nimblescape.mindbug.nodePath" points to it.`,
    );
  }
  return started;
}
