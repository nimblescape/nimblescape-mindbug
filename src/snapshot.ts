// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Builds one MemorySnapshot from a paused debug session. The frames come from the Debug Adapter Protocol (DAP) request
// stackTrace of VS Code's JavaScript debugger, which gives their names, files and lines (the debugger reads the source
// maps of TypeScript). The scopes, the variables and the heap come from V8 with the Chrome DevTools Protocol (CDP),
// through the connection of src/v8Connection.ts: V8 gives the variables of each scope in the order of the program.
// This file does not import 'vscode', so tests can run it with a fake debug session.

import type { Frame, HeapObject, MemorySnapshot, ScopeKind, Value, Variable } from './model.ts';
import {
  DEFAULT_LIMITS,
  frameExpression,
  installExpression,
  isIdentifier,
  NOT_INSTALLED,
  type WalkerLimits,
  type WalkerResult,
} from './heapWalker.ts';
import type { CdpCallFrame, CdpClient, CdpRemoteObject } from './v8Connection.ts';

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

export interface CollectOptions {
  limits?: WalkerLimits;
  /** Maximum number of frames that are read. Older frames are left out. */
  maxFrames?: number;
}

type ScopeClass = ScopeKind | 'global' | 'other';

/** The class of a scope of V8, by its type in the Chrome DevTools Protocol. */
export function classifyScope(type: string): ScopeClass {
  switch (type) {
    case 'local':
      return 'local';
    case 'block':
    case 'catch':
    case 'with':
      return 'block';
    case 'closure':
      return 'closure';
    case 'module':
    case 'script':
      return 'module';
    case 'global':
      return 'global';
    default:
      return 'other';
  }
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

/**
 * True for the frame of the function that V8 makes to set up the fields of a new object
 * (`<instance_members_initializer>`). Node.js 22 stops with a fatal error of V8 ("Check failed:
 * IsStringSet(*block_list)") when the debugger evaluates any code in this frame of a class that also has static
 * variables, so the helper never runs in it.
 */
export function isFieldSetupFrame(debuggerName: string): boolean {
  return debuggerName.includes('<instance_members_initializer>');
}

/** Parses the JSON text of a heap walker result. */
export function parseWalkerResult(text: string): WalkerResult | undefined {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && Array.isArray(v.vars) && Array.isArray(v.objects)) return v as WalkerResult;
  } catch {
    // not JSON
  }
  return undefined;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * A variable as V8 lists it in a scope, with its value. The heap walker reads the value again, with the ids of the
 * objects; the value of V8 is for the names that the heap walker cannot read, for example the return value.
 */
interface ListedVar {
  name: string;
  value?: Value;
}

interface ScopeVars {
  kind: ScopeKind;
  vars: ListedVar[];
}

/** A variable of a frame in the order of the view. */
interface DisplayVar {
  name: string;
  scope: ScopeKind;
  /** The number of the scope in the scope chain of V8, from the innermost scope. */
  group: number;
  listed: ListedVar;
}

/** A frame with the names of its variables, before the heap walker reads their values. */
interface FrameNames {
  frame: Frame;
  display: DisplayVar[];
  /** The names that an expression can read. */
  readable: string[];
}

/** What the heap walker read in a frame: its result, an error, or nothing because it is not installed. */
type FrameRead = { result: WalkerResult } | { error: string } | { notInstalled: true } | undefined;

/** The name of the return value of a function in the local scope of its frame, as VS Code's debugger shows it. */
export const RETURN_VALUE = 'Return value';

/**
 * Reads the stack and the heap of a paused thread. `v8` is the connection to V8 of the same debug session.
 * `step` is the number of this pause in the debug session (used for change highlighting).
 *
 * The requests go out in rounds: all requests of a round at the same time, and the next round when their answers are
 * back. Only the request stackTrace goes through the window of a remote session (for example a Codespace), from the
 * extension host to the window and back to the debugger. The requests to V8 go to the debugger directly (see
 * src/v8Connection.ts). A step needs three rounds, whatever the number of frames: the stack trace together with the
 * call frames of V8, the variables of all scopes, and the heap walker in all frames. The first step of a session
 * installs the walker in the round of the variables; when the walker is missing at a later step (a new program in the
 * same session), two more rounds install it and read the frames again.
 */
export async function collectSnapshot(
  dap: DapClient,
  v8: CdpClient,
  threadId: number,
  step: number,
  options: CollectOptions = {},
): Promise<MemorySnapshot> {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const maxFrames = options.maxFrames ?? 30;

  const [trace, callFrames] = await Promise.all([
    dap.request('stackTrace', { threadId, startFrame: 0, levels: 200 }),
    v8.callFrames(),
  ]);
  const allFrames: DapStackFrame[] = (trace?.stackFrames ?? []).map(withLocalPath);

  // Keep the frames of the student's code. Stop at the first async boundary: the frames
  // after it are not on the stack any more and cannot be read.
  const userFrames: DapStackFrame[] = [];
  const stackIndexes: number[] = [];
  for (let i = 0; i < allFrames.length; i++) {
    const f = allFrames[i];
    if (f.presentationHint === 'label') break;
    if (isUserFrame(f)) {
      userFrames.push(f);
      stackIndexes.push(i);
    }
    if (userFrames.length >= maxFrames) break;
  }

  const snapshot: MemorySnapshot = { step, frames: [], objects: {}, missing: [] };
  if (userFrames.length === 0) {
    return snapshot;
  }
  const top = userFrames[0];
  snapshot.location = top.source?.path ? `${baseName(top.source.path)}:${top.line}` : undefined;

  const v8Frames = matchCallFrames(callFrames, allFrames, stackIndexes);
  if (!v8Frames) throw new Error('the call frames of V8 do not match the call stack of the debugger');
  const evaluate = (i: number, expression: string) => evaluateOnCallFrame(v8, v8Frames[i], expression);

  // The newest frame where the helper can run.
  const helperIndex = userFrames.findIndex((f) => !isFieldSetupFrame(f.name));
  const install = async (): Promise<boolean> => {
    if (helperIndex < 0) return false;
    try {
      await evaluate(helperIndex, installExpression());
      return true;
    } catch {
      return false;
    }
  };
  // The walker stays in the program until the program ends, so the first step of a session installs it.
  const [named] = await Promise.all([
    Promise.all(userFrames.map((f, i) => readNames(v8, f, v8Frames[i], i === userFrames.length - 1))),
    step === 1 ? install() : undefined,
  ]);
  // The helper never runs in the frame that sets up the fields of a new object.
  const walk = (i: number) =>
    isFieldSetupFrame(userFrames[i].name) ? undefined : walkFrame((e) => evaluate(i, e), named[i], limits);
  let reads = await Promise.all(named.map((_, i) => walk(i)));

  const notInstalled = (r: FrameRead) => r !== undefined && 'notInstalled' in r;
  if (reads.some(notInstalled) && (await install())) {
    reads = await Promise.all(named.map((_, i) => (notInstalled(reads[i]) ? walk(i) : reads[i])));
  }
  snapshot.fallback = helperIndex < 0 || reads.some(notInstalled);

  const missing = new Set<number>();
  for (const r of reads) {
    if (!r || !('result' in r)) continue;
    for (const o of r.result.objects) snapshot.objects[o.id] = o;
    for (const id of r.result.missing) missing.add(id);
  }
  const frames = named.map((n, i) => withValues(n, reads[i], snapshot.objects));

  // Oldest frame first, like Python Tutor.
  snapshot.frames = frames.reverse();
  // The names of constructors and methods need the classes on the heap, which all frames together have read.
  const names = userFrames.map((f) => f.name).reverse();
  snapshot.frames.forEach((frame, i) => {
    if (frame.isGlobal) return;
    if (isFieldSetupFrame(names[i])) {
      // The helper does not run in this frame. Its only variable is `this`, the new object of the constructor below it.
      const callerThis = snapshot.frames[i - 1]?.vars.find((v) => v.name === 'this');
      frame.vars = callerThis ? [{ ...callerThis }] : [];
    }
    const self = frame.vars.find((v) => v.name === 'this')?.value;
    frame.name = frameLabel(names[i], self, snapshot.objects, snapshot.frames[i - 1]?.name);
    // At the end of a constructor, V8 gives a return value (undefined, or the new object in a subclass), which the
    // program never gets: `new` gives the new object. So the view shows no return value there.
    if (isClassSetup(frame.name)) frame.vars = frame.vars.filter((v) => v.name !== RETURN_VALUE);
  });
  snapshot.missing = [...missing].filter((id) => !(id in snapshot.objects));
  return snapshot;
}

/**
 * The call frames of V8 for the frames of the student's code, or undefined when they do not match the stack trace of
 * the debugger. VS Code's JavaScript debugger makes one stack frame of each call frame of V8, in the same order, up to
 * the first label of an async boundary. `stackIndexes` are the indexes of the frames of the student's code in
 * `allFrames`.
 */
export function matchCallFrames(
  callFrames: CdpCallFrame[],
  allFrames: DapStackFrame[],
  stackIndexes: number[],
): CdpCallFrame[] | undefined {
  const label = allFrames.findIndex((f) => f.presentationHint === 'label');
  const sync = label < 0 ? allFrames.length : label;
  // The debugger gives at most the 200 frames that collectSnapshot asks for.
  const complete = callFrames.length === sync || (label < 0 && sync >= 200 && callFrames.length > sync);
  return complete ? stackIndexes.map((i) => callFrames[i]) : undefined;
}

/**
 * Evaluates source text in a call frame of V8 and gives the string that it returns. Silent: an exception in the text
 * does not pause the program, also when the debugger pauses on caught exceptions. By value: V8 gives the whole string.
 */
async function evaluateOnCallFrame(v8: CdpClient, callFrame: CdpCallFrame, expression: string): Promise<string> {
  const res = await v8.send('Debugger.evaluateOnCallFrame', {
    callFrameId: callFrame.callFrameId,
    expression,
    silent: true,
    returnByValue: true,
  });
  if (res?.exceptionDetails) {
    throw new Error(String(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text));
  }
  if (res?.result?.type !== 'string') throw new Error('unexpected result from the heap walker');
  return String(res.result.value);
}

/** A value of V8 as a value of the view. An object is shown as text; a variable without a value is uninitialized. */
export function remoteValue(o: CdpRemoteObject | undefined): Value {
  if (!o) return { k: 'uninit' };
  switch (o.type) {
    case 'undefined':
      return { k: 'undef' };
    case 'number':
      return { k: 'num', v: o.unserializableValue ?? String(o.value) };
    case 'string':
      return { k: 'str', v: String(o.value) };
    case 'boolean':
      return { k: 'bool', v: o.value === true };
    case 'bigint':
      return { k: 'big', v: o.unserializableValue ?? o.description ?? '' };
    case 'symbol':
      return { k: 'sym', v: o.description ?? 'Symbol()' };
    default:
      return o.subtype === 'null' ? { k: 'null' } : { k: 'text', v: o.description ?? o.className ?? 'Object' };
  }
}

/** The frame of the view for a frame of the debugger, and which classes of its scopes the diagram shows. */
function frameOf(
  f: DapStackFrame,
  isLast: boolean,
  classes: ScopeClass[],
): { frame: Frame; wanted: (cls: ScopeClass) => cls is ScopeKind } {
  const isGlobal = !classes.includes('local') && (classes.includes('module') || (isLast && ANONYMOUS.test(f.name.trim())));
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
  return { frame, wanted };
}

/**
 * Reads the variables of the scopes of a call frame that the diagram shows, all scopes at the same time. V8 gives the
 * variables of a scope in the order of the program, also the ones before their line has run: a `let` that is not
 * initialized yet, and a `var` that is still undefined. At the return of a function, the local scope also lists its
 * return value.
 */
async function readNames(v8: CdpClient, f: DapStackFrame, cf: CdpCallFrame, isLast: boolean): Promise<FrameNames> {
  const scopes = cf.scopeChain.map((scope) => ({ cls: classifyScope(scope.type), scope }));
  const { frame, wanted } = frameOf(
    f,
    isLast,
    scopes.map((s) => s.cls),
  );
  const read = await Promise.all(
    scopes.map(async ({ cls, scope }): Promise<ScopeVars | undefined> => {
      const kind: ScopeClass = cls === 'other' ? 'block' : cls;
      if (!wanted(kind) || !scope.object.objectId) return undefined;
      try {
        const res = await v8.send('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true });
        const vars: ListedVar[] = (res?.result ?? []).map((p: { name: string; value?: CdpRemoteObject }) => ({
          name: String(p.name),
          value: remoteValue(p.value),
        }));
        if (kind === 'local' && cf.returnValue) vars.push({ name: RETURN_VALUE, value: remoteValue(cf.returnValue) });
        return { kind, vars };
      } catch {
        frame.note = 'Some variables could not be read.';
        return undefined;
      }
    }),
  );
  return displayOf(
    f,
    isLast,
    frame,
    read.filter((sv) => sv !== undefined),
  );
}

/** The variables of a frame in the order of the view, and the names that the heap walker reads. */
function displayOf(f: DapStackFrame, isLast: boolean, frame: Frame, scopeVars: ScopeVars[]): FrameNames {
  // The scopes come from the innermost to the outermost. The innermost name wins
  // (this is also what an expression in this frame sees).
  const seen = new Set<string>();
  let ordered: DisplayVar[] = [];
  scopeVars.forEach((sv, group) => {
    for (const v of sv.vars) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      ordered.push({ name: v.name, scope: sv.kind, group, listed: v });
    }
  });
  const localNames = ordered.filter((o) => o.scope === 'local').map((o) => o.name);
  if (!frame.isGlobal && isCommonJsModule(f.name, isLast, localNames)) {
    frame.isGlobal = true;
    frame.name = 'Global scope';
    ordered = ordered.filter((o) => !(o.scope === 'local' && COMMONJS_PARAMETERS.includes(o.name)));
  }
  // V8 gives `this` with the call frame, not in a scope. The heap walker reads it.
  if (!frame.isGlobal && !seen.has('this')) {
    ordered.push({ name: 'this', scope: 'local', group: 0, listed: { name: 'this' } });
  }

  // Display order: local variables, then block variables from the outer to the inner block,
  // then closure variables. In the Global scope: module variables, then blocks. Inside each scope, the variables keep
  // the order of V8; the sort is stable.
  const rank = (s: ScopeKind): number => (s === 'local' || s === 'module' ? 0 : s === 'block' ? 1 : 2);
  const blocksOuterFirst = ordered.filter((o) => o.scope === 'block').sort((x, y) => y.group - x.group);
  const display = [
    ...ordered.filter((o) => rank(o.scope) === 0),
    ...blocksOuterFirst,
    ...ordered.filter((o) => rank(o.scope) === 2),
  ];
  // `this` first, like a hidden first parameter.
  const thisIndex = display.findIndex((o) => o.name === 'this');
  if (thisIndex > 0) display.unshift(...display.splice(thisIndex, 1));

  const readable = display.filter((o) => isIdentifier(o.name)).map((o) => o.name);
  return { frame, display, readable };
}

/** Runs the heap walker in a frame. `evaluate` evaluates source text in the frame. */
async function walkFrame(
  evaluate: (expression: string) => Promise<string>,
  named: FrameNames,
  limits: WalkerLimits,
): Promise<FrameRead> {
  if (named.readable.length === 0) return undefined;
  try {
    const text = await evaluate(frameExpression(named.readable, limits));
    if (text === NOT_INSTALLED) return { notInstalled: true };
    const result = parseWalkerResult(text);
    if (!result) throw new Error('the heap walker result could not be parsed');
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The frame with the values of its variables. `objects` holds the heap objects that all frames together have read. */
function withValues(named: FrameNames, read: FrameRead, objects: Record<number, HeapObject>): Frame {
  const { frame, display } = named;
  if (read && 'error' in read) frame.note = `The heap could not be read in this scope: ${read.error}`;

  const walkedVars = new Map<string, Value>();
  if (read && 'result' in read) {
    for (const v of read.result.vars) walkedVars.set(v.name, v.value);
  }

  for (const o of display) {
    const value = walkedVars.get(o.name) ?? o.listed.value;
    // Only `this` has no value of V8: without the heap walker, it is not shown.
    if (!value) continue;
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
  return frame;
}
