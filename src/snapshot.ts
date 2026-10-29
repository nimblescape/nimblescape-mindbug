// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Builds one MemorySnapshot from a paused debug session. The frames come from the Debug Adapter Protocol (DAP) request
// stackTrace of VS Code's JavaScript debugger, which gives their names, files and lines (the debugger reads the source
// maps of TypeScript). The scopes, the variables and the heap come from V8 with the Chrome DevTools Protocol (CDP),
// through the connection of src/v8Connection.ts: V8 gives the variables of each scope in the order of the program.
// This file does not import 'vscode', so tests can run it with a fake debug session.

import { blockKind, ScriptText } from './blockKind.ts';
import type { BlockKind, Frame, HeapObject, MemorySnapshot, ScopeKind, Value, Variable } from './model.ts';
import {
  DEFAULT_LIMITS,
  GLOBAL_NAME,
  installFunction,
  NOT_INSTALLED,
  WALKER_VERSION,
  walkerFunction,
  type WalkerLimits,
  type WalkerResult,
} from './heapWalker.ts';
import type { CdpCallFrame, CdpClient, CdpRemoteObject, CdpScope } from './v8Connection.ts';

/** The part of a debug session that the collector needs. */
export interface DapClient {
  /** The body of the answer, as the debugger sends it: the caller checks what it reads. */
  request(command: string, args?: object): Promise<unknown>;
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
  // VS Code's JavaScript debugger marks a frame without a place in the TypeScript file ("Skipped by smartStep"), for
  // example the function of Node.js that runs a compiled CommonJS module, at line 1 of the compiled file.
  if (frame.presentationHint === 'deemphasize') return false;
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
 * A variable as V8 lists it in a scope: `value` is its value as text of V8, for a program without the heap walker, and
 * `remote` the value of V8 itself, which goes to the heap walker. A variable without a value (a `let` before its line)
 * has neither.
 */
interface ListedVar {
  name: string;
  value?: Value;
  remote?: CdpRemoteObject;
}

interface ScopeVars {
  kind: ScopeKind;
  vars: ListedVar[];
  /** For a block scope: its statement. */
  statement?: BlockKind;
  /** A block scope around the function, which the view shows as a closure. */
  outerBlock?: boolean;
}

/** A variable of a frame in the order of the view. */
interface DisplayVar {
  name: string;
  scope: ScopeKind;
  /** The number of the scope in the scope chain of V8, from the innermost scope. */
  group: number;
  /** For a variable of a block: the number of the block, from the outermost block (1). */
  block?: number;
  /** A variable of a block scope around the function. */
  outerBlock?: boolean;
  listed: ListedVar;
  /** The index of its value in the arguments of the heap walker, when it has a value. */
  arg?: number;
}

/** A frame with its variables, before the heap walker reads their values. */
interface FrameNames {
  frame: Frame;
  display: DisplayVar[];
  /** The object id of V8 on which the heap walker runs: the global object of the frame. */
  target?: string;
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
  const body = trace as { stackFrames?: DapStackFrame[] } | undefined;
  const allFrames: DapStackFrame[] = (body?.stackFrames ?? []).map(withLocalPath);

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

  // The newest frame where the helper can run.
  const helperIndex = userFrames.findIndex((f) => !isFieldSetupFrame(f.name));
  const install = async (): Promise<boolean> => {
    const target = helperIndex < 0 ? undefined : targetOf(v8Frames[helperIndex]);
    if (!target) return false;
    try {
      await callFunction(v8, target, installFunction(), [{ value: WALKER_VERSION }, { value: GLOBAL_NAME }]);
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
  const walk = (i: number) => (isFieldSetupFrame(userFrames[i].name) ? undefined : walkFrame(v8, named[i], limits));
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

/** The object id of the global object of a call frame, on which the functions of Mindbug run in the program. */
function targetOf(callFrame: CdpCallFrame): string | undefined {
  const scopes = callFrame.scopeChain;
  return (scopes.find((s) => s.type === 'global') ?? scopes[0])?.object.objectId;
}

/** A value of V8 as an argument of `Runtime.callFunctionOn`: an object by its id, any other value by its value. */
export function callArgument(o: CdpRemoteObject): object {
  if (o.objectId) return { objectId: o.objectId };
  if (o.unserializableValue !== undefined) return { unserializableValue: o.unserializableValue };
  if (o.type === 'undefined') return {};
  return { value: o.value };
}

/**
 * Runs a function of Mindbug in the program and gives the string that it returns. `target` is an object id of V8:
 * the function runs in the realm of that object, and gets `args` (values, or objects by their ids). It does not run
 * in the scope of a call frame, so it reads no variable by its name. Silent: an exception does not pause the program,
 * also when the debugger pauses on caught exceptions. By value: V8 gives the whole string.
 */
async function callFunction(v8: CdpClient, target: string, declaration: string, args: object[]): Promise<string> {
  const res = (await v8.send('Runtime.callFunctionOn', {
    objectId: target,
    functionDeclaration: declaration,
    arguments: args,
    silent: true,
    returnByValue: true,
  })) as { result?: CdpRemoteObject; exceptionDetails?: { text?: string; exception?: CdpRemoteObject } } | undefined;
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
    column: f.column,
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
  // A block scope after the scope of the function, or of the module, is no block of this frame. It is a block around
  // the function, whose variables the function uses (the view shows them as closure variables), or the scope of the
  // class around a method, with the name of the class. V8 gives it no position in the code of the function.
  const own = scopes.findIndex((s) => s.cls === 'local' || s.cls === 'module');
  const { frame, wanted } = frameOf(
    f,
    isLast,
    scopes.map((s) => s.cls),
  );
  const read = await Promise.all(
    scopes.map(async ({ cls, scope }, index): Promise<ScopeVars | undefined> => {
      const block = cls === 'block' || cls === 'other';
      const outerBlock = block && own >= 0 && index > own;
      const kind: ScopeClass = outerBlock ? 'closure' : block ? 'block' : cls;
      if (!wanted(kind) || !scope.object.objectId) return undefined;
      try {
        const [res, statement] = await Promise.all([
          v8.send('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true }) as Promise<
            { result?: { name: string; value?: CdpRemoteObject }[] } | undefined
          >,
          kind === 'block' ? statementOf(v8, scope) : undefined,
        ]);
        const vars: ListedVar[] = (res?.result ?? []).map((p) => ({
          name: String(p.name),
          value: remoteValue(p.value),
          remote: p.value,
        }));
        if (kind === 'local' && cf.returnValue) {
          vars.push({ name: RETURN_VALUE, value: remoteValue(cf.returnValue), remote: cf.returnValue });
        }
        return outerBlock ? { kind, vars, outerBlock } : { kind, vars, statement };
      } catch {
        frame.note = 'Some variables could not be read.';
        return undefined;
      }
    }),
  );
  const named = displayOf(
    f,
    isLast,
    frame,
    read.filter((sv) => sv !== undefined),
    cf.this,
  );
  return { ...named, target: targetOf(cf) };
}

/** The texts of the scripts by their ids, for each connection to V8: a script does not change while it runs. */
const scriptTexts = new WeakMap<CdpClient, Map<string, Promise<ScriptText | undefined>>>();

/** The text of a script of the program, from V8 (once for each script). */
function scriptText(v8: CdpClient, scriptId: string): Promise<ScriptText | undefined> {
  let texts = scriptTexts.get(v8);
  if (!texts) scriptTexts.set(v8, (texts = new Map()));
  let text = texts.get(scriptId);
  if (!text) {
    text = (v8.send('Debugger.getScriptSource', { scriptId }) as Promise<{ scriptSource?: unknown } | undefined>).then(
      (res) => (typeof res?.scriptSource === 'string' ? new ScriptText(res.scriptSource) : undefined),
      () => {
        // The next step asks again.
        texts.delete(scriptId);
        return undefined;
      },
    );
    texts.set(scriptId, text);
  }
  return text;
}

/** The statement of a block scope, from the code where V8 says that it starts. A plain block when that is unknown. */
async function statementOf(v8: CdpClient, scope: CdpScope): Promise<BlockKind> {
  if (scope.type === 'catch') return 'catch';
  const at = scope.startLocation;
  const script = at && (await scriptText(v8, at.scriptId));
  const offset = at && script?.offset(at.lineNumber, at.columnNumber);
  return script && offset !== undefined ? blockKind(script.text, offset, scope.type) : 'block';
}

/** The variables of a frame in the order of the view, and the values that the heap walker reads. */
function displayOf(
  f: DapStackFrame,
  isLast: boolean,
  frame: Frame,
  scopeVars: ScopeVars[],
  thisValue: CdpRemoteObject,
): FrameNames {
  // The scopes come from the innermost to the outermost. Each scope keeps all its variables: a variable of a block
  // can have the name of a variable of an outer scope, which it hides from the code of the block, and the view shows
  // both. The blocks get their numbers from the outermost block (1) to the innermost.
  const blockGroups = scopeVars.flatMap((sv, group) => (sv.kind === 'block' ? [group] : [])).reverse();
  if (blockGroups.length > 0) frame.blocks = blockGroups.map((g) => scopeVars[g].statement ?? 'block');
  let hasThis = false;
  let ordered: DisplayVar[] = [];
  scopeVars.forEach((sv, group) => {
    const block = sv.kind === 'block' ? blockGroups.indexOf(group) + 1 : undefined;
    for (const v of sv.vars) {
      if (v.name === 'this') {
        if (hasThis) continue;
        hasThis = true;
      }
      ordered.push({ name: v.name, scope: sv.kind, group, block, outerBlock: sv.outerBlock, listed: v });
    }
  });
  const localNames = ordered.filter((o) => o.scope === 'local').map((o) => o.name);
  if (!frame.isGlobal && isCommonJsModule(f.name, isLast, localNames)) {
    frame.isGlobal = true;
    frame.name = 'Global scope';
    ordered = ordered.filter((o) => !(o.scope === 'local' && COMMONJS_PARAMETERS.includes(o.name)));
  }
  // V8 gives `this` with the call frame, not in a scope. Only the heap walker gives its value to the view.
  if (!frame.isGlobal && !hasThis) {
    ordered.push({ name: 'this', scope: 'local', group: 0, listed: { name: 'this', remote: thisValue } });
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

  let arg = 0;
  for (const o of display) if (o.listed.remote) o.arg = arg++;
  return { frame, display };
}

/** Runs the heap walker for the values of the variables of a frame. */
async function walkFrame(v8: CdpClient, named: FrameNames, limits: WalkerLimits): Promise<FrameRead> {
  const values = named.display.flatMap((o) => (o.listed.remote ? [callArgument(o.listed.remote)] : []));
  if (values.length === 0 || !named.target) return undefined;
  try {
    const text = await callFunction(v8, named.target, walkerFunction(), [{ value: limits }, ...values]);
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

  // The heap walker names the value of each variable by its index in its arguments.
  const walked = new Map<string, Value>();
  if (read && 'result' in read) {
    for (const v of read.result.vars) walked.set(v.name, v.value);
  }

  for (const o of display) {
    const value = (o.arg === undefined ? undefined : walked.get(String(o.arg))) ?? o.listed.value;
    // Only `this` has no value of V8: without the heap walker, it is not shown.
    if (!value) continue;
    if (o.name === 'this') {
      if (value.k === 'undef' || value.k === 'null') continue;
      if (value.k === 'ref' && objects[value.id]?.type === 'globalThis') continue;
    }
    // Inside a method, V8 shows the class's own name binding in a block scope around the method.
    // It is not a variable of the method, so it is left out.
    if (o.outerBlock && value.k === 'ref') {
      const target = objects[value.id];
      if (target?.kind === 'class' && target.type === o.name) continue;
    }
    const variable: Variable = { name: o.name, value, scope: o.scope };
    if (o.block !== undefined) variable.block = o.block;
    frame.vars.push(variable);
  }
  return frame;
}
