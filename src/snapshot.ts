// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Builds one MemorySnapshot from a paused debug session, using only standard
// Debug Adapter Protocol requests: stackTrace, scopes, variables, evaluate.
// This file does not import 'vscode', so tests can run it with a fake debug session.

import type { Frame, HeapObject, MemorySnapshot, ScopeKind, Value, Variable } from './model.ts';
import {
  DEFAULT_LIMITS,
  frameExpression,
  GLOBAL_NAME,
  installExpression,
  isIdentifier,
  type WalkerLimits,
  type WalkerResult,
} from './heapWalker.ts';

/** The part of a debug session that the collector needs. */
export interface DapClient {
  request(command: string, args?: object): Promise<any>;
}

export interface DapSource {
  name?: string;
  path?: string;
  sourceReference?: number;
  presentationHint?: string;
  origin?: string;
}

export interface DapStackFrame {
  id: number;
  name: string;
  line: number;
  column: number;
  source?: DapSource;
  presentationHint?: string;
}

export interface DapScope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
  presentationHint?: string;
}

export interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface CollectOptions {
  limits?: WalkerLimits;
  /** Maximum number of frames that are read. Older frames are left out. */
  maxFrames?: number;
}

type ScopeClass = ScopeKind | 'global' | 'other';

/** Classifies a scope by the name that VS Code's JavaScript debugger gives it. */
export function classifyScope(scope: DapScope): ScopeClass {
  const n = scope.name.trim().toLowerCase();
  if (/^(local|lokal)\b/.test(n)) return 'local';
  if (/^(block|catch|with)\b/.test(n)) return 'block';
  if (/^closure\b/.test(n)) return 'closure';
  if (/^(module|modul|script|skript)\b/.test(n)) return 'module';
  if (/^global\b/.test(n) || scope.expensive) return 'global';
  if (scope.presentationHint === 'locals') return 'local';
  return 'other';
}

/**
 * The file path of a source path. In a remote window (VS Code in the browser, or a Dev Container, SSH or WSL
 * window), the stack frames that `customRequest` returns name the files of the remote computer as URIs, for example
 * `vscode-remote://dev-container+abc/workspaces/app/sort.ts`: VS Code turns the paths of the debugger into URIs on
 * the way to the window and does not turn them back. Mindbug runs on the remote computer, where the path of such a
 * URI is the path of the file. Every other path stays as it is.
 */
export function localPath(path: string): string {
  const m = /^(?:vscode-remote:\/\/[^/]*|file:\/\/)(\/.*)$/i.exec(path);
  if (!m) return path;
  let p: string;
  try {
    p = decodeURIComponent(m[1]);
  } catch {
    return path;
  }
  // A Windows path: "/c:/Users/s/sort.ts" is "c:\Users\s\sort.ts", as the debugger names it
  return /^\/[a-z]:\//i.test(p) ? p.slice(1).replace(/\//g, '\\') : p;
}

/** The frame with the file path of its source (see `localPath`). */
function withLocalPath(frame: DapStackFrame): DapStackFrame {
  const path = frame.source?.path;
  if (!path) return frame;
  const local = localPath(path);
  return local === path ? frame : { ...frame, source: { ...frame.source, path: local } };
}

/** True when the frame belongs to the student's own code (not Deno or Node internals). */
export function isUserFrame(frame: DapStackFrame): boolean {
  if (frame.presentationHint === 'label' || frame.presentationHint === 'subtle') return false;
  const src = frame.source;
  if (!src || !src.path) return false;
  if (src.presentationHint === 'deemphasize') return false;
  // A file of the student is a file on disk. VS Code's JavaScript debugger gives Deno's own (minified) code a
  // relative path such as "deno_node/console.ts" and a sourceReference, because its text comes from the debugger.
  if (src.sourceReference) return false;
  const p = src.path;
  if (!/^(\/|[a-z]:[\\/]|\\\\)/i.test(p)) return false;
  if (/^(ext|node|deno|internal|eval|wasm):/i.test(p) || p.startsWith('<')) return false;
  if (/[\\/]node_modules[\\/]/.test(p)) return false;
  return true;
}

const ANONYMOUS = /^(<anonymous>|\(anonymous\)|anonymous|<module>|)$/;

/** The parameters of the function in which Node.js runs a CommonJS module (a file without import or export). */
const COMMONJS_PARAMETERS = ['exports', 'require', 'module', '__filename', '__dirname'];

/**
 * True for the frame of a CommonJS module in Node.js: the outermost frame, without a name, with the parameters
 * of the module function. Its variables are the global variables of the file, as in the Module scope of an ES module.
 */
export function isCommonJsModule(name: string, isLast: boolean, localNames: string[]): boolean {
  return isLast && ANONYMOUS.test(name.trim()) && COMMONJS_PARAMETERS.every((p) => localNames.includes(p));
}

/**
 * Readable names for the functions that V8 creates for class fields:
 * `<instance_members_initializer>` runs the field initializers of `new Person()`,
 * `<static_initializer>` sets the static variables of a class.
 */
export function frameName(name: string): string {
  const prefix = (n: string) => n.replace(/\.?<[a-z_]+>$/, '');
  if (name.includes('<instance_members_initializer>')) {
    const cls = prefix(name);
    return cls ? `${cls} (set up fields)` : '(set up fields)';
  }
  if (name.includes('<static_initializer>')) {
    const cls = prefix(name);
    return cls ? `${cls} (set up static variables)` : '(set up static variables)';
  }
  return name;
}

/** The class `id` and its superclasses, the class first. */
function classChain(objects: Record<number, HeapObject>, id: number | undefined): HeapObject[] {
  const chain: HeapObject[] = [];
  for (let c = id === undefined ? undefined : objects[id]; c && c.kind === 'class' && chain.length < 50; ) {
    chain.push(c);
    c = c.superId === undefined ? undefined : objects[c.superId];
  }
  return chain;
}

/**
 * The name of a frame of a constructor or a method: "Person.constructor", "Person.birthday".
 * The class is the class that declares the function, not the class of `this`: VS Code's debugger
 * writes the class of `this` in front of a method name ("Student.birthday" for a method of Person),
 * and V8 alone names a constructor only by its class ("Person"). `debuggerName` is the name from the debugger,
 * `thisValue` the value of `this` in the frame, and `caller` the name of the frame that called it.
 */
export function frameLabel(
  debuggerName: string,
  thisValue: Value | undefined,
  objects: Record<number, HeapObject>,
  caller?: string,
): string {
  // VS Code's debugger already names a constructor by its class, also for super(...).
  if (/^[^.]+\.constructor$/.test(debuggerName)) return debuggerName;
  const thisObj = thisValue?.k === 'ref' ? objects[thisValue.id] : undefined;
  const isStatic = thisObj?.kind === 'class';
  const chain = classChain(objects, isStatic ? thisObj?.id : thisObj?.cls);

  // The debugger names the class of `this` ("Function" for a class) in front of the function name. In a function
  // that runs without an object, `this` is the global object in Node.js, and the debugger writes "global.".
  let base = debuggerName;
  for (const p of [chain[0]?.type, 'Function', thisValue === undefined ? 'global' : undefined]) {
    if (p && base.startsWith(`${p}.`)) {
      base = base.slice(p.length + 1);
      break;
    }
  }

  if (base === '<instance_members_initializer>') {
    // The constructor of the class that declares the fields runs them.
    const owner = caller?.endsWith('.constructor') ? caller.slice(0, -'.constructor'.length) : chain[0]?.type;
    return owner ? `${owner} (set up fields)` : '(set up fields)';
  }
  if (base === '<static_initializer>') return frameName(chain[0] ? `${chain[0].type}.${base}` : base);

  const declares = (c: HeapObject) =>
    c.methods?.some((m) => m.isStatic === isStatic && (m.name === `${base}()` || m.name === base));
  const owner = chain.find(declares);
  if (owner) return `${owner.type}.${base}`;
  // A constructor: in a subclass before super(...) returns, `this` cannot be read yet.
  const classes = chain.length > 0 ? chain : Object.values(objects).filter((o) => o.kind === 'class');
  if (!isStatic && classes.some((c) => c.type === base)) return `${base}.constructor`;
  return frameName(base);
}

/**
 * True for the frame of a constructor ("Person.constructor") and of the set-up of the fields or the static variables
 * of a class ("Person (set up fields)", see frameLabel). Such a frame gives no value back to the program:
 * `new Person()` gives the new object, and V8 makes the set-up functions itself.
 */
export function isClassSetup(label: string): boolean {
  return /\.constructor$|\(set up (fields|static variables)\)$/.test(label);
}

/** Removes the quotes that a debugger may put around a string result. */
export function unquote(text: string): string {
  const t = text.trim();
  if (t.length < 2) return t;
  const q = t[0];
  if ((q !== '"' && q !== "'" && q !== '`') || t[t.length - 1] !== q) return t;
  if (q === '"') {
    try {
      const s = JSON.parse(t);
      if (typeof s === 'string') return s;
    } catch {
      // fall through to the manual unescape below
    }
  }
  return t.slice(1, -1).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/gs, (_m, e: string) => {
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    return simple[e] ?? e;
  });
}

/** Parses the heap walker result. Accepts raw JSON text or a quoted string that holds it. */
export function parseWalkerResult(text: string): WalkerResult | undefined {
  for (const candidate of [text, unquote(text)]) {
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === 'object' && Array.isArray(v.vars) && Array.isArray(v.objects)) {
        return v as WalkerResult;
      }
    } catch {
      // try the next form
    }
  }
  return undefined;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

interface ScopeVars {
  kind: ScopeKind;
  vars: DapVariable[];
}

interface ReadFrame {
  frame: Frame;
  /**
   * The names in the local scope that are not variables of the program: at a return, VS Code's JavaScript debugger
   * adds the return value of the function, with a name in the display language of VS Code ("Return value",
   * "Rückgabewert" in German).
   */
  notVariables: Set<string>;
}

/**
 * Reads the stack and the heap of a paused thread.
 * `step` is the number of this pause in the debug session (used for change highlighting).
 */
export async function collectSnapshot(
  dap: DapClient,
  threadId: number,
  step: number,
  options: CollectOptions = {},
): Promise<MemorySnapshot> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const maxFrames = options.maxFrames ?? 30;

  const trace = await dap.request('stackTrace', { threadId, startFrame: 0, levels: 200 });
  const allFrames: DapStackFrame[] = (trace?.stackFrames ?? []).map(withLocalPath);

  // Keep the frames of the student's code. Stop at the first async boundary: the frames
  // after it are not on the stack any more and cannot be read.
  const userFrames: DapStackFrame[] = [];
  for (const f of allFrames) {
    if (f.presentationHint === 'label') break;
    if (isUserFrame(f)) userFrames.push(f);
    if (userFrames.length >= maxFrames) break;
  }

  const snapshot: MemorySnapshot = { step, frames: [], objects: {}, missing: [] };
  if (userFrames.length === 0) {
    return snapshot;
  }
  const top = userFrames[0];
  snapshot.location = top.source?.path ? `${baseName(top.source.path)}:${top.line}` : undefined;

  // Install the heap walker (once per program run; later calls only check the version).
  let walkerReady = true;
  try {
    await dap.request('evaluate', { expression: installExpression(), frameId: top.id, context: 'clipboard' });
  } catch {
    walkerReady = false;
  }
  snapshot.fallback = !walkerReady;

  const missing = new Set<number>();
  const reads: ReadFrame[] = [];

  for (let index = 0; index < userFrames.length; index++) {
    const f = userFrames[index];
    const isLast = index === userFrames.length - 1;
    reads.push(await readFrame(dap, f, isLast, walkerReady, limits, snapshot.objects, missing));
  }

  // Oldest frame first, like Python Tutor.
  reads.reverse();
  snapshot.frames = reads.map((r) => r.frame);
  // The names of constructors and methods need the classes on the heap, which all frames together have read.
  const names = userFrames.map((f) => f.name).reverse();
  snapshot.frames.forEach((frame, i) => {
    if (frame.isGlobal) return;
    const self = frame.vars.find((v) => v.name === 'this')?.value;
    frame.name = frameLabel(names[i], self, snapshot.objects, snapshot.frames[i - 1]?.name);
    // At the end of a constructor, the debugger shows a return value (undefined, or the new object in a subclass),
    // which the program never gets: `new` gives the new object. So the view shows no return value there.
    if (isClassSetup(frame.name)) frame.vars = frame.vars.filter((v) => !reads[i].notVariables.has(v.name));
  });
  snapshot.missing = [...missing].filter((id) => !(id in snapshot.objects));
  return snapshot;
}

async function readScopes(dap: DapClient, frameId: number): Promise<{ cls: ScopeClass; scope: DapScope }[]> {
  const res = await dap.request('scopes', { frameId });
  const scopes: DapScope[] = res?.scopes ?? [];
  return scopes.map((scope) => ({ cls: classifyScope(scope), scope }));
}

async function readFrame(
  dap: DapClient,
  f: DapStackFrame,
  isLast: boolean,
  walkerReady: boolean,
  limits: WalkerLimits,
  objects: Record<number, HeapObject>,
  missing: Set<number>,
): Promise<ReadFrame> {
  const scopes = await readScopes(dap, f.id);
  const hasLocal = scopes.some((s) => s.cls === 'local');
  const hasModule = scopes.some((s) => s.cls === 'module');
  let isGlobal = !hasLocal && (hasModule || (isLast && ANONYMOUS.test(f.name.trim())));

  const frame: Frame = {
    frameId: f.id,
    name: isGlobal ? 'Global scope' : frameName(f.name),
    isGlobal,
    line: f.line,
    file: f.source?.path,
    vars: [],
  };

  // Which scopes belong to this frame in the diagram.
  const wanted = (cls: ScopeClass): cls is ScopeKind => {
    if (cls === 'global') return false;
    if (cls === 'module') return isGlobal;
    if (cls === 'closure') return !isGlobal;
    return true; // local, block, other
  };

  const scopeVars: ScopeVars[] = [];
  for (const { cls, scope } of scopes) {
    const kind: ScopeClass = cls === 'other' ? 'block' : cls;
    if (!wanted(kind) || scope.variablesReference <= 0) continue;
    try {
      const res = await dap.request('variables', { variablesReference: scope.variablesReference });
      scopeVars.push({ kind, vars: res?.variables ?? [] });
    } catch {
      frame.note = 'Some variables could not be read.';
    }
  }

  // DAP lists scopes from the innermost to the outermost. The innermost name wins
  // (this is also what an expression in this frame sees).
  const seen = new Set<string>();
  let ordered: { name: string; scope: ScopeKind; dap: DapVariable }[] = [];
  for (const sv of scopeVars) {
    for (const v of sv.vars) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      ordered.push({ name: v.name, scope: sv.kind, dap: v });
    }
  }
  const localNames = ordered.filter((o) => o.scope === 'local').map((o) => o.name);
  if (!isGlobal && isCommonJsModule(f.name, isLast, localNames)) {
    isGlobal = true;
    frame.isGlobal = true;
    frame.name = 'Global scope';
    const hidden = new Set([...COMMONJS_PARAMETERS, 'this']);
    ordered = ordered.filter((o) => !(o.scope === 'local' && hidden.has(o.name)));
  }
  if (!isGlobal && !seen.has('this')) {
    ordered.push({ name: 'this', scope: 'local', dap: { name: 'this', value: '', variablesReference: 0 } });
  }

  // Display order: local variables, then block variables from the outer to the inner block,
  // then closure variables. In the Global scope: module variables, then blocks.
  const rank = (s: ScopeKind): number => (s === 'local' || s === 'module' ? 0 : s === 'block' ? 1 : 2);
  const blocksInnerFirst = ordered.filter((o) => o.scope === 'block');
  const display = [
    ...ordered.filter((o) => rank(o.scope) === 0),
    ...blocksInnerFirst.reverse(),
    ...ordered.filter((o) => rank(o.scope) === 2),
  ];
  // `this` first, like a hidden first parameter.
  const thisIndex = display.findIndex((o) => o.name === 'this');
  if (thisIndex > 0) display.unshift(...display.splice(thisIndex, 1));

  const readable = display.filter((o) => isIdentifier(o.name)).map((o) => o.name);
  let walked: WalkerResult | undefined;
  if (walkerReady && readable.length > 0) {
    try {
      walked = await evaluateFrame(dap, f.id, readable, limits);
    } catch (e) {
      frame.note = `The heap could not be read in this scope: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const walkedVars = new Map<string, Value>();
  if (walked) {
    for (const v of walked.vars) walkedVars.set(v.name, v.value);
    for (const o of walked.objects) objects[o.id] = o;
    for (const id of walked.missing) missing.add(id);
  }

  // The program cannot read a name that the debugger added: it is not an identifier, or the helper found no variable
  // of that name.
  const notVariables = new Set(
    display
      .filter((o) => o.scope === 'local' && o.name !== 'this')
      .filter((o) => !isIdentifier(o.name) || walkedVars.get(o.name)?.k === 'unavail')
      .map((o) => o.name),
  );

  for (const o of display) {
    let value: Value | undefined = walkedVars.get(o.name);
    if (!value) {
      if (o.name === 'this') continue;
      value = { k: 'text', v: o.dap.value };
    }
    if (o.name === 'this') {
      if (value.k === 'undef' || value.k === 'null') continue;
      if (value.k === 'ref' && objects[value.id]?.type === 'globalThis') continue;
    }
    // Inside a method, V8 shows the class's own name binding as a block scope variable.
    // It is not a variable of the method, so it is left out.
    if (!frame.isGlobal && o.scope === 'block' && value.k === 'ref') {
      const target = objects[value.id];
      if (target?.kind === 'class' && target.type === o.name) continue;
    }
    const variable: Variable = { name: o.name, value, scope: o.scope };
    frame.vars.push(variable);
  }
  return { frame, notVariables };
}

async function evaluateFrame(
  dap: DapClient,
  frameId: number,
  names: string[],
  limits: WalkerLimits,
): Promise<WalkerResult> {
  const res = await dap.request('evaluate', {
    expression: frameExpression(names, limits),
    frameId,
    context: 'clipboard',
  });
  const text: string = res?.result ?? '';
  const parsed = parseWalkerResult(text);
  if (parsed) return parsed;

  // The debugger shortened the text. Read it again in small pieces.
  const sizeRes = await dap.request('evaluate', {
    expression: `globalThis.${GLOBAL_NAME}.size()`,
    frameId,
    context: 'clipboard',
  });
  const size = Number(unquote(String(sizeRes?.result ?? '0')));
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error('unexpected result from the heap walker');
  }
  const chunkSize = 150;
  let full = '';
  for (let i = 0; i * chunkSize < size; i++) {
    const part = await dap.request('evaluate', {
      expression: `globalThis.${GLOBAL_NAME}.chunk(${i}, ${chunkSize})`,
      frameId,
      context: 'clipboard',
    });
    full += decodeURIComponent(unquote(String(part?.result ?? '')));
  }
  const again = parseWalkerResult(full);
  if (!again) throw new Error('the heap walker result could not be parsed');
  return again;
}
