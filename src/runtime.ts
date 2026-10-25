// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The configuration that the debug type "mindbug" starts a program with: one of the debug type "ts" of the extension
// nimblescape TypeScript (nimblescape.nimblescape-typescript, an extension dependency of Mindbug). That debug type runs
// the program with the command ts: ts checks and compiles the program with the TypeScript compiler that VS Code uses,
// and runs the JavaScript with Node.js in VS Code's JavaScript debugger. Only the debug type "mindbug" and the command
// "Run with Mindbug" (launch.ts) use this file. The Mindbug view does not know how the program runs: it reads every
// debug session of VS Code's JavaScript debugger, also one that a launch configuration of another type starts. This
// file does not import 'vscode' at run time, so unit tests can run it.

import * as path from 'node:path';
import type * as vscode from 'vscode';

/** The debug type of the extension nimblescape TypeScript, which runs a program with the command ts. */
export const TS_DEBUG_TYPE = 'ts';

/** The extension that contributes the debug type "ts" (extensionDependencies in package.json). */
export const TS_EXTENSION = 'nimblescape.nimblescape-typescript';

/**
 * The debug configuration of type "ts" for one TypeScript file. `attributes` are the other attributes of the launch
 * configuration of type "mindbug" (for example args, env or console): they pass through to the debug type "ts".
 * The debug type "ts" sets the attributes of the JavaScript debugger that the compiled program needs (the path of ts,
 * the source maps, skipFiles), and it implements stopOnEntry: the program pauses at its first statement.
 */
export function debugConfiguration(
  file: string,
  cwd: string,
  stopOnEntry: boolean,
  attributes: Record<string, unknown> = {},
): vscode.DebugConfiguration {
  return {
    name: `Mindbug: ${path.basename(file)}`,
    ...attributes,
    type: TS_DEBUG_TYPE,
    request: 'launch',
    program: file,
    cwd,
    stopOnEntry,
  };
}
