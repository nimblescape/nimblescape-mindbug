// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Runs TypeScript files in Node.js with the TypeScript compiler that VS Code uses. Node.js only strips the types of a
// TypeScript file; Node.js 26 has no option that also runs enums and constructor parameter properties. Mindbug starts
// Node.js with `--require dist/typeScriptHooks.js` and names the compiler (the file typescript.js) in the environment
// variable NIMBLESCAPE_MINDBUG_TYPESCRIPT (runtime.ts, nodeTypeScript). This file runs in the program, before its first
// line. It registers a synchronous hook of the module loader of Node.js (module.registerHooks), which turns each
// TypeScript file into JavaScript before Node.js runs it: with the options of the tsconfig.json of the file, as the
// project compiles it, and with an inline source map, so the debugger shows the TypeScript file. The hook changes only
// the options that a run in memory needs (see compilerOptions). This file imports only modules of Node.js: the
// compiler comes from VS Code or from the project, and nothing else of Mindbug runs in the program.

import * as fs from 'node:fs';
import { findPackageJSON, registerHooks } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The environment variable with the compiler file typescript.js. */
export const TYPESCRIPT_VARIABLE = 'NIMBLESCAPE_MINDBUG_TYPESCRIPT';

/** Compiler options of TypeScript, as the API of the compiler has them (numbers for the enums). */
export type CompilerOptions = Record<string, unknown>;

/** A diagnostic of the compiler, with the parts that the hooks read. */
interface Diagnostic {
  category: number;
  file?: object;
  start?: number;
  messageText: unknown;
}

/** The part of the API of the TypeScript compiler (typescript.js of TypeScript 5 and 6) that the hooks use. */
export interface TypeScript {
  sys: { fileExists(file: string): boolean; readFile(file: string): string | undefined };
  ModuleKind: { CommonJS: number; ESNext: number };
  ScriptTarget: { ESNext: number };
  ScriptKind: { TS: number };
  DiagnosticCategory: { Error: number };
  findConfigFile(dir: string, fileExists: (file: string) => boolean): string | undefined;
  readConfigFile(file: string, readFile: (file: string) => string | undefined): { config?: unknown };
  parseJsonConfigFileContent(
    json: unknown,
    host: object,
    basePath: string,
    existingOptions?: CompilerOptions,
    configFileName?: string,
  ): { options: CompilerOptions };
  transpileModule(
    input: string,
    options: { compilerOptions: CompilerOptions; fileName: string; reportDiagnostics: boolean },
  ): { outputText: string; diagnostics?: Diagnostic[] };
  createSourceFile(file: string, text: string, target: number, setParentNodes: boolean, kind: number): object;
  isExternalModule(file: object): boolean;
  getLineAndCharacterOfPosition(file: object, position: number): { line: number; character: number };
  flattenDiagnosticMessageText(text: unknown, newLine: string): string;
}

/**
 * The format of a TypeScript file, as Node.js decides it: a .mts file is an ES module, a .cts file a CommonJS module. A
 * .ts file has the "type" of its package.json (`packageType`). Without a "type", a file with `import`, `export` or
 * `import.meta` is an ES module (`isModuleSyntax`), any other file a CommonJS module.
 */
export function moduleFormat(file: string, packageType: unknown, isModuleSyntax: () => boolean): 'esm' | 'cjs' {
  if (file.endsWith('.mts')) return 'esm';
  if (file.endsWith('.cts')) return 'cjs';
  if (packageType === 'module') return 'esm';
  if (packageType === 'commonjs') return 'cjs';
  return isModuleSyntax() ? 'esm' : 'cjs';
}

/**
 * The options with which the hooks compile a file: the options of the project (`project`, from its tsconfig.json),
 * with the changes that a run in memory needs. The module format is the format of the file (moduleFormat), the
 * JavaScript stays in memory with an inline source map that holds the TypeScript text, and imports keep the extension
 * .ts, which Node.js loads with these hooks.
 */
export function compilerOptions(ts: TypeScript, project: CompilerOptions, format: 'esm' | 'cjs'): CompilerOptions {
  return {
    ...project,
    module: format === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
    moduleResolution: undefined,
    noEmit: false,
    emitDeclarationOnly: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: true,
    inlineSources: true,
    sourceRoot: undefined,
    mapRoot: undefined,
    outDir: undefined,
    outFile: undefined,
    rootDir: undefined,
    rewriteRelativeImportExtensions: false,
  };
}

/** The hooks for the compiler `ts`. */
export function typeScriptHooks(ts: TypeScript): { load: Parameters<typeof registerHooks>[0]['load'] } {
  const formats = new Map<string, 'esm' | 'cjs'>();
  const projects = new Map<string, CompilerOptions>();

  const formatOf = (url: string, file: string): 'esm' | 'cjs' => {
    let format = formats.get(url);
    if (!format) {
      const packageJson = findPackageJSON(url);
      format = moduleFormat(file, packageJson ? packageType(packageJson) : undefined, () =>
        ts.isExternalModule(ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS)),
      );
      formats.set(url, format);
    }
    return format;
  };

  // The options of the tsconfig.json of a file. The hooks need only the options, not the list of the files of the
  // project, so the host lists no folder.
  const projectOf = (file: string): CompilerOptions => {
    const config = ts.findConfigFile(path.dirname(file), ts.sys.fileExists);
    if (!config) return {};
    let options = projects.get(config);
    if (!options) {
      const json = ts.readConfigFile(config, ts.sys.readFile).config ?? {};
      options = ts.parseJsonConfigFileContent(json, { ...ts.sys, readDirectory: () => [] }, path.dirname(config), undefined, config).options;
      projects.set(config, options);
    }
    return options;
  };

  return {
    load(url, context, nextLoad) {
      const file = typeScriptFile(url);
      if (!file) return nextLoad(url, context);
      const format = formatOf(url, file);
      // With the format, Node.js reads the file and does not look at its code: for a .ts file without "type", Node.js
      // would strip the types to look for `import` and `export`, and stop at an enum.
      const loaded = nextLoad(url, { ...context, format: format === 'esm' ? 'module-typescript' : 'commonjs-typescript' });
      const output = ts.transpileModule(String(loaded.source), {
        compilerOptions: compilerOptions(ts, projectOf(file), format),
        fileName: file,
        reportDiagnostics: true,
      });
      const error = output.diagnostics?.find((d) => d.category === ts.DiagnosticCategory.Error && d.file);
      if (error) throw syntaxError(ts, file, error);
      return { format: format === 'esm' ? 'module' : 'commonjs', source: output.outputText, shortCircuit: true };
    },
  };
}

/** The file of a URL of a TypeScript file (.ts, .mts, .cts) on disk, else undefined. */
function typeScriptFile(url: string): string | undefined {
  if (!url.startsWith('file:')) return undefined;
  const file = fileURLToPath(url);
  return /\.[cm]?ts$/.test(file) && !/\.d\.[cm]?ts$/.test(file) ? file : undefined;
}

/** The "type" of a package.json file, or undefined. */
function packageType(file: string): unknown {
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { type?: unknown }).type;
  } catch {
    return undefined;
  }
}

/** The error of Node.js for a syntax error in a TypeScript file: file, line and column, and the message of TypeScript. */
function syntaxError(ts: TypeScript, file: string, d: Diagnostic): SyntaxError {
  const at = d.file && d.start !== undefined ? ts.getLineAndCharacterOfPosition(d.file, d.start) : undefined;
  const where = at ? `${file}:${at.line + 1}:${at.character + 1}` : file;
  return new SyntaxError(`${where}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
}

const compiler = process.env[TYPESCRIPT_VARIABLE];
if (compiler) {
  // The program does not see the variable, and the programs that it starts do not get it.
  delete process.env[TYPESCRIPT_VARIABLE];
  registerHooks(typeScriptHooks(require(compiler) as TypeScript));
}
