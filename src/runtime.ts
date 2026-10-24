// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The runtimes that the debug type "mindbug" can start a program with: Deno and Node.js.
// Only the debug type "mindbug" and the command "Run with Mindbug" (launch.ts) use this file. The Mindbug view does not
// know the runtime: it reads every debug session of VS Code's JavaScript debugger, also one that a launch configuration
// of another type starts. This file does not import 'vscode' at run time, so unit tests can run it.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';

export type Runtime = 'deno' | 'node';

export interface LaunchSettings {
  runtime: Runtime | 'auto';
  denoPath: string;
  nodePath: string;
  /** Port on which the runtime waits for the debugger. */
  port: number;
  stopOnEntry: boolean;
}

/** Node.js runs TypeScript files from version 22.7 on, with the option --experimental-transform-types. */
export const MIN_NODE: [number, number] = [22, 7];

/** Node.js 26 removed the option --experimental-transform-types: it only strips the types. */
export const NODE_WITHOUT_TRANSFORM = 26;

/**
 * The options with which Node.js runs a TypeScript file. With tsx (an npm package of the project), Node.js runs all of
 * TypeScript, also enums and constructor parameter properties, as `npx tsx` does in the terminal. Without tsx, Node.js
 * 22.7 to 25 transform these with --experimental-transform-types; Node.js 26 and newer only strip the types, so a
 * program with an enum or a parameter property stops with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
 */
export function nodeTypeScriptArgs(version: string, tsx: boolean): string[] {
  if (tsx) return ['--import', 'tsx'];
  const major = Number(/^v?(\d+)/.exec(version.trim())?.[1]);
  return major >= NODE_WITHOUT_TRANSFORM ? [] : ['--experimental-transform-types', '--disable-warning=ExperimentalWarning'];
}

/** True when `dir` or a folder above it has the npm package tsx in node_modules, where `--import tsx` finds it. */
export function hasTsx(dir: string): boolean {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (existsSync(path.join(d, 'node_modules', 'tsx', 'package.json'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

/**
 * The debug configuration for one TypeScript file. The runtime waits for the debugger on `port` (--inspect-brk), and
 * VS Code's JavaScript debugger connects to it (`attachSimplePort`), the same way for Deno and Node.js. The type is
 * "pwa-node" (the name of VS Code's JavaScript debugger for "node"): with the type "node" and `attachSimplePort`, the
 * debugger continues at the pause of --inspect-brk, so the program does not stop at its first line.
 */
export function debugConfiguration(
  file: string,
  cwd: string,
  runtime: Runtime,
  s: LaunchSettings,
  nodeArgs: string[] = [],
): vscode.DebugConfiguration {
  const inspect = `${s.stopOnEntry ? '--inspect-brk' : '--inspect-wait'}=127.0.0.1:${s.port}`;
  // Node.js runs a TypeScript file directly, with the options of nodeTypeScriptArgs.
  const runtimeArgs = runtime === 'deno' ? ['run', inspect, '--allow-all'] : [inspect, ...nodeArgs];
  return {
    type: 'pwa-node',
    request: 'launch',
    name: `Mindbug: ${path.basename(file)}`,
    program: file,
    cwd,
    runtimeExecutable: runtime === 'deno' ? s.denoPath : s.nodePath,
    runtimeArgs,
    attachSimplePort: s.port,
    stopOnEntry: s.stopOnEntry,
    console: 'internalConsole',
    outputCapture: 'std',
    skipFiles: SKIP_FILES,
  };
}

/**
 * The code of the runtime, which a step does not stop in. Node.js: `<node_internals>`. Deno: the URLs that start with
 * "ext:", such as ext:runtime_main/js/99_main.js, which runs after the last line of the program, and
 * ext:deno_web/01_console.js. The skip patterns of V8 have no effect on the code of Deno (tested with Deno 2.9), but
 * the JavaScript debugger then steps on by itself ("smartStep", on by default) until the program is in a file that is
 * not skipped, or has ended. So a step after the last line ends the program, and Step Into on console.log does not go
 * into the code of Deno. With tsx: its loader in node_modules/tsx.
 */
export const SKIP_FILES = ['<node_internals>/**', 'ext:*/**', '**/node_modules/tsx/**'];

/** The output of `program --version`, or undefined when the program does not run. */
export function versionOf(program: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(program, ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim());
    });
  });
}

/** True for a Node.js version (`node --version`, such as "v24.1.0") that runs TypeScript files. */
export function nodeRunsTypeScript(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/**
 * The runtime to start the program with, with the Node.js options (nodeTypeScriptArgs), or the reason why there is
 * none (a message for the student).
 */
export type RuntimeChoice = { runtime: 'deno' } | { runtime: 'node'; nodeArgs: string[] } | { problem: string };

/**
 * The runtime of the settings, after a check that it runs. "auto" takes Node.js with tsx when the project in `cwd`
 * has tsx (the project runs its programs with tsx), else Deno when it runs, else Node.js when it runs TypeScript files.
 */
export async function chooseRuntime(
  s: LaunchSettings,
  cwd: string,
  version = versionOf,
  tsxIn = hasTsx,
): Promise<RuntimeChoice> {
  const minNode = `Node.js ${MIN_NODE.join('.')} or newer`;
  const tsx = s.runtime !== 'deno' && tsxIn(cwd);
  const node = s.runtime === 'deno' ? undefined : await version(s.nodePath);
  const nodeRuns = node !== undefined && nodeRunsTypeScript(node);
  if (s.runtime === 'auto' && tsx && nodeRuns) return { runtime: 'node', nodeArgs: nodeTypeScriptArgs(node, true) };
  const deno = s.runtime === 'node' ? undefined : await version(s.denoPath);
  if (deno) return { runtime: 'deno' };
  if (s.runtime === 'deno') {
    return { problem: `Mindbug did not find Deno ("${s.denoPath}"). Install Deno, or set "nimblescape.mindbug.denoPath".` };
  }
  if (nodeRuns) return { runtime: 'node', nodeArgs: nodeTypeScriptArgs(node, tsx) };
  const old = node ? ` ("${s.nodePath}" is Node.js ${node}, which cannot run TypeScript files)` : '';
  if (s.runtime === 'node') {
    return { problem: `Mindbug needs ${minNode}${old || ` and did not find "${s.nodePath}"`}. Install it, or set "nimblescape.mindbug.nodePath".` };
  }
  return {
    problem:
      `Mindbug needs Deno or ${minNode}, and found neither${old}. Install one of them, ` +
      'or set "nimblescape.mindbug.denoPath" or "nimblescape.mindbug.nodePath".',
  };
}
