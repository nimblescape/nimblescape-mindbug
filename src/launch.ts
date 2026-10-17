// The debug type "mindbug" and the command "Run with Mindbug".
// A launch configuration of type "mindbug" names the TypeScript file and, if wanted, the runtime. Mindbug has no debug
// adapter of its own: MindbugConfigurationProvider turns the configuration into one of VS Code's built-in JavaScript
// debugger for Deno or Node.js (runtime.ts), and VS Code starts that debugger. The command "Run with Mindbug" starts a
// configuration of type "mindbug" for one file, so students do not need a launch.json file. The attribute "runtime" or
// the setting "nimblescape.mindbug.runtime" chooses the runtime; with "auto" Mindbug takes Deno when it is installed,
// else Node.js.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { chooseRuntime, debugConfiguration, type LaunchSettings } from './runtime.ts';

export const DEBUG_TYPE = 'mindbug';

/** A launch configuration of type "mindbug". package.json describes its attributes (contributes.debuggers). */
interface MindbugConfiguration extends vscode.DebugConfiguration {
  program?: string;
  cwd?: string;
  runtime?: string;
  stopOnEntry?: boolean;
}

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

/** The configuration for the file of the active editor: F5 without launch.json starts it. */
function currentFile(): MindbugConfiguration {
  return { type: DEBUG_TYPE, request: 'launch', name: 'Mindbug: current file', program: '${file}' };
}

export class MindbugConfigurationProvider implements vscode.DebugConfigurationProvider {
  /** The configuration that the list of "Run and Debug" shows under "Mindbug", also without launch.json. */
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [currentFile()];
  }

  /**
   * Turns a configuration of type "mindbug" into one of VS Code's JavaScript debugger. Because the type changes,
   * VS Code then resolves the new configuration with the provider of the JavaScript debugger, and after that it
   * replaces variables such as ${file}. Undefined stops the launch, after a message that says why.
   */
  async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: MindbugConfiguration,
  ): Promise<vscode.DebugConfiguration | undefined> {
    // F5 without launch.json gives an empty configuration.
    const c = config.type || config.request || config.name ? config : currentFile();
    if (c.request !== 'launch') {
      void vscode.window.showErrorMessage(`The launch configuration "${c.name}" of type "mindbug" needs "request": "launch".`);
      return undefined;
    }
    const settings = readLaunchSettings();
    if (c.runtime !== undefined) {
      if (c.runtime !== 'auto' && c.runtime !== 'deno' && c.runtime !== 'node') {
        void vscode.window.showErrorMessage(
          `The launch configuration "${c.name}" has "runtime": "${c.runtime}". Use "auto", "deno" or "node".`,
        );
        return undefined;
      }
      settings.runtime = c.runtime;
    }
    if (typeof c.stopOnEntry === 'boolean') settings.stopOnEntry = c.stopOnEntry;
    const choice = await chooseRuntime(settings);
    if ('problem' in choice) {
      void vscode.window.showErrorMessage(choice.problem);
      return undefined;
    }
    const cwd = c.cwd ?? folder?.uri.fsPath ?? '${fileDirname}';
    return { ...debugConfiguration(c.program ?? '${file}', cwd, choice.runtime, settings), name: c.name || 'Mindbug' };
  }
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

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const config: MindbugConfiguration = {
    type: DEBUG_TYPE,
    request: 'launch',
    name: `Mindbug: ${path.basename(uri.fsPath)}`,
    program: uri.fsPath,
    cwd: folder?.uri.fsPath ?? path.dirname(uri.fsPath),
  };
  return vscode.debug.startDebugging(folder, config);
}
