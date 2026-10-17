// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The runtimes that the debug type "mindbug" can start a program with: Deno and Node.js.
// Only the debug type "mindbug" and the command "Run with Mindbug" (launch.ts) use this file. The Mindbug view does not
// know the runtime: it reads every debug session of VS Code's JavaScript debugger, also one that a launch configuration
// of another type starts. This file does not import 'vscode' at run time, so unit tests can run it.

import { execFile } from 'node:child_process';
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

/**
 * The debug configuration for one TypeScript file. The runtime waits for the debugger on `port` (--inspect-brk), and
 * VS Code's JavaScript debugger connects to it (`attachSimplePort`), the same way for Deno and Node.js. The type is
 * "pwa-node" (the name of VS Code's JavaScript debugger for "node"): with the type "node" and `attachSimplePort`, the
 * debugger continues at the pause of --inspect-brk, so the program does not stop at its first line.
 */
export function debugConfiguration(file: string, cwd: string, runtime: Runtime, s: LaunchSettings): vscode.DebugConfiguration {
  const inspect = `${s.stopOnEntry ? '--inspect-brk' : '--inspect-wait'}=127.0.0.1:${s.port}`;
  const runtimeArgs =
    runtime === 'deno'
      ? ['run', inspect, '--allow-all']
      : // Node.js runs a TypeScript file directly; --experimental-transform-types also runs enums and constructor
        // parameter properties.
        [inspect, '--experimental-transform-types', '--disable-warning=ExperimentalWarning'];
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
    skipFiles: ['<node_internals>/**'],
  };
}

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

/** The runtime to start the program with, or the reason why there is none (a message for the student). */
export type RuntimeChoice = { runtime: Runtime } | { problem: string };

/**
 * The runtime of the settings, after a check that it runs: for "auto" Deno when it runs, else Node.js when it runs
 * TypeScript files.
 */
export async function chooseRuntime(s: LaunchSettings, version = versionOf): Promise<RuntimeChoice> {
  const minNode = `Node.js ${MIN_NODE.join('.')} or newer`;
  const deno = s.runtime === 'node' ? undefined : await version(s.denoPath);
  if (deno) return { runtime: 'deno' };
  if (s.runtime === 'deno') {
    return { problem: `Mindbug did not find Deno ("${s.denoPath}"). Install Deno, or set "nimblescape.mindbug.denoPath".` };
  }
  const node = await version(s.nodePath);
  if (node && nodeRunsTypeScript(node)) return { runtime: 'node' };
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
