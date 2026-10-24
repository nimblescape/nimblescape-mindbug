// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The runtimes that the debug type "mindbug" can start a program with: Deno and Node.js.
// Only the debug type "mindbug" and the command "Run with Mindbug" (launch.ts) use this file. The Mindbug view does not
// know the runtime: it reads every debug session of VS Code's JavaScript debugger, also one that a launch configuration
// of another type starts. This file does not import 'vscode' at run time, so unit tests can run it.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
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

/** Node.js 26 removed the option --experimental-transform-types: it only strips the types of a TypeScript file. */
export const NODE_WITHOUT_TRANSFORM = 26;

/** The environment variable with the TypeScript compiler for the hooks of Mindbug (typeScriptHooks.ts). */
export const TYPESCRIPT_VARIABLE = 'NIMBLESCAPE_MINDBUG_TYPESCRIPT';

/** How Node.js runs a TypeScript file: its options, and the environment variables of the program. */
export interface NodeTypeScript {
  args: string[];
  env: Record<string, string>;
}

/**
 * The debug configuration for one TypeScript file. The runtime waits for the debugger on `port` (--inspect-brk), and
 * VS Code's JavaScript debugger connects to it (`attachSimplePort`), the same way for Deno and Node.js. The type is
 * "pwa-node" (the name of VS Code's JavaScript debugger for "node"): with the type "node" and `attachSimplePort`, the
 * debugger continues at the pause of --inspect-brk, so the program does not stop at its first line. `typeScript` says
 * how Node.js runs the TypeScript file (`nodeTypeScript`).
 */
export function debugConfiguration(
  file: string,
  cwd: string,
  runtime: Runtime,
  s: LaunchSettings,
  typeScript: NodeTypeScript = { args: [], env: {} },
): vscode.DebugConfiguration {
  const inspect = `${s.stopOnEntry ? '--inspect-brk' : '--inspect-wait'}=127.0.0.1:${s.port}`;
  const runtimeArgs = runtime === 'deno' ? ['run', inspect, '--allow-all'] : [inspect, ...typeScript.args];
  const env = runtime === 'node' && Object.keys(typeScript.env).length > 0 ? { env: typeScript.env } : {};
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
    ...env,
  };
}

/**
 * The code of the runtime, which a step does not stop in. Node.js: `<node_internals>`. Deno: the URLs that start with
 * "ext:", such as ext:runtime_main/js/99_main.js, which runs after the last line of the program, and
 * ext:deno_web/01_console.js. The skip patterns of V8 have no effect on the code of Deno (tested with Deno 2.9), but
 * the JavaScript debugger then steps on by itself ("smartStep", on by default) until the program is in a file that is
 * not skipped, or has ended. So a step after the last line ends the program, and Step Into on console.log does not go
 * into the code of Deno.
 */
export const SKIP_FILES = ['<node_internals>/**', 'ext:*/**'];

/** The output of `program --version`, or undefined when the program does not run. */
export function versionOf(program: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(program, ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim());
    });
  });
}

/** The major and minor number of a Node.js version (`node --version`, such as "v24.1.0"). */
function nodeVersion(version: string): [number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** True for a Node.js version (`node --version`) that is `min` or newer. */
function atLeast(version: string, min: [number, number]): boolean {
  const v = nodeVersion(version);
  if (!v) return false;
  const [major, minor] = v;
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

/** True for a Node.js version (`node --version`, such as "v24.1.0") that runs TypeScript files. */
export function nodeRunsTypeScript(version: string): boolean {
  return atLeast(version, MIN_NODE);
}

/**
 * True for a Node.js version that runs the hooks of Mindbug (typeScriptHooks.ts): it has synchronous module hooks
 * (module.registerHooks) and strips the types of a TypeScript file without an option. Node.js 22.18 and newer, 23.6
 * and newer, and 24 and later.
 */
export function nodeRunsHooks(version: string): boolean {
  const v = nodeVersion(version);
  if (!v) return false;
  const [major, minor] = v;
  return major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
}

/**
 * How Node.js of `version` runs a TypeScript file. With a TypeScript compiler (`typescript`, its file typescript.js,
 * see typeScriptCompiler), Node.js runs the hooks of Mindbug (`hooks`, the file dist/typeScriptHooks.js): they turn
 * each TypeScript file into JavaScript with that compiler and the tsconfig.json of the file, so all of TypeScript runs,
 * also enums and constructor parameter properties. Without the hooks, Node.js 22.7 to 25 run the file with
 * --experimental-transform-types, which also runs enums and parameter properties. Node.js 26 and later only strip the
 * types and stop with the error ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at an enum or a parameter property.
 */
export function nodeTypeScript(version: string, typescript: string | undefined, hooks: string): NodeTypeScript {
  if (typescript && nodeRunsHooks(version)) return { args: ['--require', hooks], env: { [TYPESCRIPT_VARIABLE]: typescript } };
  const major = nodeVersion(version)?.[0] ?? 0;
  const args = major < NODE_WITHOUT_TRANSFORM ? ['--experimental-transform-types', '--disable-warning=ExperimentalWarning'] : [];
  return { args, env: {} };
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

/**
 * True when the program in the folder `dir` belongs to a Deno project: the folder or a folder above it has a deno.json
 * or deno.jsonc file. `exists` gives the file system to the unit tests.
 */
export function isDenoProject(dir: string, exists: (file: string) => boolean = fs.existsSync): boolean {
  for (let folder = path.resolve(dir); ; folder = path.dirname(folder)) {
    if (exists(path.join(folder, 'deno.json')) || exists(path.join(folder, 'deno.jsonc'))) return true;
    if (path.dirname(folder) === folder) return false;
  }
}

/** The runtime to start the program with, or the reason why there is none (a message for the student). */
export type RuntimeChoice = { runtime: 'deno' } | { runtime: 'node'; version: string } | { problem: string };

/**
 * The runtime of the settings, after a check that it runs. "auto" prefers Node.js: Node.js when it runs TypeScript
 * files, else Deno. Only for a Deno project (`denoProject`, see `isDenoProject`) it prefers Deno.
 */
export async function chooseRuntime(s: LaunchSettings, denoProject: boolean, version = versionOf): Promise<RuntimeChoice> {
  const minNode = `Node.js ${MIN_NODE.join('.')} or newer`;
  const order: Runtime[] = s.runtime !== 'auto' ? [s.runtime] : denoProject ? ['deno', 'node'] : ['node', 'deno'];
  let node: string | undefined;
  for (const runtime of order) {
    if (runtime === 'deno') {
      if (await version(s.denoPath)) return { runtime: 'deno' };
      continue;
    }
    node = await version(s.nodePath);
    if (node && nodeRunsTypeScript(node)) return { runtime: 'node', version: node };
  }
  if (s.runtime === 'deno') {
    return { problem: `Mindbug did not find Deno ("${s.denoPath}"). Install Deno, or set "nimblescape.mindbug.denoPath".` };
  }
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
