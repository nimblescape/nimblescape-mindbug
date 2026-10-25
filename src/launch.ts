// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The debug type "mindbug" and the command "Run with Mindbug".
// A launch configuration of type "mindbug" names the TypeScript file. Mindbug has no debug adapter of its own:
// MindbugConfigurationProvider turns the configuration into one of VS Code's built-in JavaScript debugger for Node.js
// (runtime.ts), and VS Code starts that debugger. The command "Run with Mindbug" starts a configuration of type
// "mindbug" for one file, so students do not need a launch.json file.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { debugConfiguration, findNode, nodeTypeScript, typeScriptCompiler, type LaunchSettings } from './runtime.ts';

export const DEBUG_TYPE = 'mindbug';

/** A launch configuration of type "mindbug". package.json describes its attributes (contributes.debuggers). */
interface MindbugConfiguration extends vscode.DebugConfiguration {
  program?: string;
  cwd?: string;
  /** The attribute of Mindbug 0.1, which could choose Deno. */
  runtime?: string;
  stopOnEntry?: boolean;
}

export function readLaunchSettings(): LaunchSettings {
  const c = vscode.workspace.getConfiguration('nimblescape.mindbug');
  return {
    nodePath: c.get<string>('nodePath', 'node') || 'node',
    port: c.get<number>('inspectPort', 9229),
    stopOnEntry: c.get<boolean>('stopOnEntry', true),
  };
}

/** The configuration for the file of the active editor: F5 without launch.json starts it. */
function currentFile(): MindbugConfiguration {
  return { type: DEBUG_TYPE, request: 'launch', name: 'Mindbug: current file', program: '${file}' };
}

/**
 * The TypeScript compiler that VS Code uses (typeScriptCompiler): the settings js/ts.tsdk.path and typescript.tsdk (an
 * older name of the same setting) of the workspace folder `folder`, else the TypeScript that VS Code ships.
 */
function vscodeTypeScript(folder: vscode.WorkspaceFolder | undefined): string | undefined {
  const c = vscode.workspace.getConfiguration(undefined, folder?.uri);
  const folders = [folder, ...(vscode.workspace.workspaceFolders ?? [])].flatMap((f) => (f ? [f.uri.fsPath] : []));
  return typeScriptCompiler([c.get<string>('js/ts.tsdk.path'), c.get<string>('typescript.tsdk')], folders, vscode.env.appRoot);
}

export class MindbugConfigurationProvider implements vscode.DebugConfigurationProvider {
  /** The file of the hooks with which Node.js runs TypeScript (dist/typeScriptHooks.js, see nodeTypeScript). */
  private readonly hooks: string;
  /** The switch "Stop on entry" of the view; without it, the setting decides. */
  private readonly stopOnEntry: (() => boolean) | undefined;

  constructor(hooks: string, stopOnEntry?: () => boolean) {
    this.hooks = hooks;
    this.stopOnEntry = stopOnEntry;
  }

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
    if (this.stopOnEntry) settings.stopOnEntry = this.stopOnEntry();
    // Mindbug 0.1 could run the program with Deno. "auto" and "node" now both mean Node.js.
    if (c.runtime === 'deno') {
      void vscode.window.showErrorMessage(
        `Mindbug runs programs with Node.js only. Remove "runtime": "deno" from the launch configuration "${c.name}". ` +
          'To debug with Deno, use a launch configuration of type "node" with "runtimeExecutable": "deno": ' +
          'the Mindbug view also shows it.',
      );
      return undefined;
    }
    if (typeof c.stopOnEntry === 'boolean') settings.stopOnEntry = c.stopOnEntry;
    const node = await findNode(settings);
    if ('problem' in node) {
      void vscode.window.showErrorMessage(node.problem);
      return undefined;
    }
    const program = c.program ?? '${file}';
    const cwd = c.cwd ?? folder?.uri.fsPath ?? '${fileDirname}';
    const typeScript = nodeTypeScript(vscodeTypeScript(folder), this.hooks);
    return { ...debugConfiguration(program, cwd, settings, typeScript), name: c.name || 'Mindbug' };
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
