// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The runtime that the debug type "mindbug" starts a program with: Node.js, with the TypeScript compiler of VS Code.
// Only the debug type "mindbug" and the command "Run with Mindbug" (launch.ts) use this file. The Mindbug view does not
// know the runtime: it reads every debug session of VS Code's JavaScript debugger, also one that a launch configuration
// of another type starts. This file does not import 'vscode' at run time, so unit tests can run it.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';

export interface LaunchSettings {
  nodePath: string;
  /** Port on which Node.js waits for the debugger. */
  port: number;
  stopOnEntry: boolean;
}

/**
 * The oldest major version of Node.js that Mindbug starts: Node.js 24 has the synchronous module hooks
 * (module.registerHooks) for the hooks of Mindbug (typeScriptHooks.ts), and strips the types of a TypeScript file
 * without an option.
 */
export const MIN_NODE = 24;

/** The environment variable with the TypeScript compiler for the hooks of Mindbug (typeScriptHooks.ts). */
export const TYPESCRIPT_VARIABLE = 'NIMBLESCAPE_MINDBUG_TYPESCRIPT';

/** How Node.js runs a TypeScript file: its options, and the environment variables of the program. */
export interface NodeTypeScript {
  args: string[];
  env: Record<string, string>;
}

/**
 * The debug configuration for one TypeScript file. Node.js waits for the debugger on `port` (--inspect-brk), and
 * VS Code's JavaScript debugger connects to it (`attachSimplePort`). The type is "pwa-node" (the name of VS Code's
 * JavaScript debugger for "node"): with the type "node" and `attachSimplePort`, the debugger continues at the pause of
 * --inspect-brk, so the program does not stop at its first line. `typeScript` says how Node.js runs the TypeScript file
 * (`nodeTypeScript`).
 */
export function debugConfiguration(
  file: string,
  cwd: string,
  s: LaunchSettings,
  typeScript: NodeTypeScript = { args: [], env: {} },
): vscode.DebugConfiguration {
  const inspect = `${s.stopOnEntry ? '--inspect-brk' : '--inspect-wait'}=127.0.0.1:${s.port}`;
  const env = Object.keys(typeScript.env).length > 0 ? { env: typeScript.env } : {};
  return {
    type: 'pwa-node',
    request: 'launch',
    name: `Mindbug: ${path.basename(file)}`,
    program: file,
    cwd,
    runtimeExecutable: s.nodePath,
    runtimeArgs: [inspect, ...typeScript.args],
    attachSimplePort: s.port,
    stopOnEntry: s.stopOnEntry,
    console: 'internalConsole',
    outputCapture: 'std',
    skipFiles: SKIP_FILES,
    ...env,
  };
}

/** The code of Node.js, which a step does not stop in. */
export const SKIP_FILES = ['<node_internals>/**'];

/** The output of `program --version`, or undefined when the program does not run. */
export function versionOf(program: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(program, ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim());
    });
  });
}

/** True for a Node.js version (`node --version`, such as "v24.1.0") that Mindbug starts: MIN_NODE or newer. */
export function nodeRunsTypeScript(version: string): boolean {
  const m = /^v?(\d+)\.\d+/.exec(version.trim());
  return m !== null && Number(m[1]) >= MIN_NODE;
}

/**
 * How Node.js runs a TypeScript file. With a TypeScript compiler (`typescript`, its file typescript.js, see
 * typeScriptCompiler), Node.js runs the hooks of Mindbug (`hooks`, the file dist/typeScriptHooks.js): they turn each
 * TypeScript file into JavaScript with that compiler and the tsconfig.json of the file, so all of TypeScript runs, also
 * enums and constructor parameter properties. Without a compiler, Node.js only strips the types and stops with the
 * error ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at an enum or a parameter property. Mindbug uses no experimental option of
 * Node.js.
 */
export function nodeTypeScript(typescript: string | undefined, hooks: string): NodeTypeScript {
  return typescript ? { args: ['--require', hooks], env: { [TYPESCRIPT_VARIABLE]: typescript } } : { args: [], env: {} };
}

/**
 * The TypeScript compiler (its file typescript.js) that VS Code uses, or undefined. The settings js/ts.tsdk.path and,
 * before it, typescript.tsdk (`tsdks`, in this order) name the folder lib of a TypeScript package; VS Code resolves a
 * relative path against the workspace folders (`folders`). Without these settings, or when their folder has no
 * typescript.js (TypeScript 7 has none), Mindbug takes the TypeScript that VS Code ships: the folder
 * extensions/node_modules/typescript/lib of VS Code (`appRoot`). `exists` gives the file system to the unit tests.
 */
export function typeScriptCompiler(
  tsdks: (string | undefined)[],
  folders: string[],
  appRoot: string,
  exists: (file: string) => boolean = fs.existsSync,
): string | undefined {
  const files: string[] = [];
  for (const tsdk of tsdks) {
    if (!tsdk) continue;
    const libs = path.isAbsolute(tsdk) ? [tsdk] : folders.map((folder) => path.join(folder, tsdk));
    files.push(...libs.map((lib) => path.join(lib, 'typescript.js')));
  }
  files.push(path.join(appRoot, 'extensions', 'node_modules', 'typescript', 'lib', 'typescript.js'));
  return files.find((file) => exists(file));
}

/** The version of Node.js (`node --version`), or the reason why it cannot run the program (a message for the student). */
export type NodeChoice = { version: string } | { problem: string };

/** The Node.js of the settings, after a check that it is Node.js MIN_NODE or newer. */
export async function findNode(s: LaunchSettings, version = versionOf): Promise<NodeChoice> {
  const node = await version(s.nodePath);
  if (node && nodeRunsTypeScript(node)) return { version: node };
  const minNode = `Node.js ${MIN_NODE} or newer`;
  const found = node ? `"${s.nodePath}" is Node.js ${node}, which is too old` : `did not find "${s.nodePath}"`;
  return { problem: `Mindbug needs ${minNode} and ${found}. Install it, or set "nimblescape.mindbug.nodePath".` };
}
