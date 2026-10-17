// The runtimes that "Run with Mindbug" can start a program with: Deno and Node.js.
// Only the command "Run with Mindbug" (launch.ts) uses this file. The Mindbug view does not know the runtime: it reads
// every debug session of VS Code's JavaScript debugger, also one that a launch configuration of the student starts.
// This file does not import 'vscode' at run time, so unit tests can run it.

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

/** The runtime of the settings; for "auto" Deno when it runs, else Node.js when it runs TypeScript files. */
export async function chooseRuntime(s: LaunchSettings, version = versionOf): Promise<Runtime | undefined> {
  if (s.runtime !== 'auto') return s.runtime;
  if (await version(s.denoPath)) return 'deno';
  const node = await version(s.nodePath);
  return node && nodeRunsTypeScript(node) ? 'node' : undefined;
}
