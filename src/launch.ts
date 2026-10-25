// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The debug type "mindbug" and the command "Run with Mindbug".
// A launch configuration of type "mindbug" names the TypeScript file. Mindbug has no debug adapter of its own:
// MindbugConfigurationProvider turns the configuration into one of the debug type "ts" of the extension nimblescape
// TypeScript (runtime.ts), which runs the program with the command ts in VS Code's JavaScript debugger. The command
// "Run with Mindbug" starts a configuration of type "mindbug" for one file, so students do not need a launch.json file.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { debugConfiguration } from './runtime.ts';

export const DEBUG_TYPE = 'mindbug';

/** A launch configuration of type "mindbug". package.json describes its attributes (contributes.debuggers). */
interface MindbugConfiguration extends vscode.DebugConfiguration {
  program?: string;
  cwd?: string;
  /** The attribute of Mindbug 0.1, which could choose Deno. */
  runtime?: string;
  stopOnEntry?: boolean;
}

/** The setting nimblescape.mindbug.stopOnEntry. */
function stopOnEntrySetting(): boolean {
  return vscode.workspace.getConfiguration('nimblescape.mindbug').get<boolean>('stopOnEntry', true);
}

/** The configuration for the file of the active editor: F5 without launch.json starts it. */
function currentFile(): MindbugConfiguration {
  return { type: DEBUG_TYPE, request: 'launch', name: 'Mindbug: current file', program: '${file}' };
}

export class MindbugConfigurationProvider implements vscode.DebugConfigurationProvider {
  /** The switch "Stop on entry" of the view; without it, the setting decides. */
  private readonly stopOnEntry: (() => boolean) | undefined;

  constructor(stopOnEntry?: () => boolean) {
    this.stopOnEntry = stopOnEntry;
  }

  /** The configuration that the list of "Run and Debug" shows under "Mindbug", also without launch.json. */
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [currentFile()];
  }

  /**
   * Turns a configuration of type "mindbug" into one of type "ts". Because the type changes, VS Code then resolves
   * the new configuration with the provider of the debug type "ts", which turns it into one of VS Code's JavaScript
   * debugger, and after that VS Code replaces variables such as ${file}. Undefined stops the launch, after a message
   * that says why.
   */
  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: MindbugConfiguration,
  ): vscode.DebugConfiguration | undefined {
    // F5 without launch.json gives an empty configuration.
    const c = config.type || config.request || config.name ? config : currentFile();
    if (c.request !== 'launch') {
      void vscode.window.showErrorMessage(`The launch configuration "${c.name}" of type "mindbug" needs "request": "launch".`);
      return undefined;
    }
    // Mindbug 0.1 could run the program with Deno. "auto" and "node" now both mean the command ts.
    if (c.runtime === 'deno') {
      void vscode.window.showErrorMessage(
        `Mindbug runs programs with Node.js only. Remove "runtime": "deno" from the launch configuration "${c.name}". ` +
          'To debug with Deno, use a launch configuration of type "node" with "runtimeExecutable": "deno": ' +
          'the Mindbug view also shows it.',
      );
      return undefined;
    }
    const stopOnEntry = typeof c.stopOnEntry === 'boolean' ? c.stopOnEntry : (this.stopOnEntry?.() ?? stopOnEntrySetting());
    // The other attributes, such as args, env and console, pass through to the debug type "ts".
    const { runtime: _runtime, ...attributes } = c;
    const cwd = c.cwd ?? folder?.uri.fsPath ?? '${fileDirname}';
    return { ...debugConfiguration(c.program ?? '${file}', cwd, stopOnEntry, attributes), name: c.name || 'Mindbug' };
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
