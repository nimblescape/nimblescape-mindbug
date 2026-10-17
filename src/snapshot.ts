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

/** True when the frame belongs to the student's own code (not Deno or Node internals). */
export function isUserFrame(frame: DapStackFrame): boolean {
  if (frame.presentationHint === 'label' || frame.presentationHint === 'subtle') return false;
  const src = frame.source;
  if (!src || !src.path) return false;
  if (src.presentationHint === 'deemphasize') return false;
  const p = src.path;
  if (/^(ext|node|deno|internal|eval|wasm):/i.test(p) || p.startsWith('<')) return false;
  if (/[\\/]node_modules[\\/]/.test(p)) return false;
  return true;
}

const ANONYMOUS = /^(<anonymous>|\(anonymous\)|anonymous|<module>|)$/;

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
  const allFrames: DapStackFrame[] = trace?.stackFrames ?? [];

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
  const frames: Frame[] = [];

  for (let index = 0; index < userFrames.length; index++) {
    const f = userFrames[index];
    const isLast = index === userFrames.length - 1;
    const frame = await readFrame(dap, f, isLast, walkerReady, limits, snapshot.objects, missing);
    frames.push(frame);
  }

  // Oldest frame first, like Python Tutor.
  snapshot.frames = frames.reverse();
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
): Promise<Frame> {
  const scopes = await readScopes(dap, f.id);
  const hasLocal = scopes.some((s) => s.cls === 'local');
  const hasModule = scopes.some((s) => s.cls === 'module');
  const isGlobal = !hasLocal && (hasModule || (isLast && ANONYMOUS.test(f.name.trim())));

  const frame: Frame = {
    frameId: f.id,
    name: isGlobal ? 'Global frame' : frameName(f.name),
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
  const ordered: { name: string; scope: ScopeKind; dap: DapVariable }[] = [];
  for (const sv of scopeVars) {
    for (const v of sv.vars) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      ordered.push({ name: v.name, scope: sv.kind, dap: v });
    }
  }
  if (!isGlobal && !seen.has('this')) {
    ordered.push({ name: 'this', scope: 'local', dap: { name: 'this', value: '', variablesReference: 0 } });
  }

  // Display order: local variables, then block variables from the outer to the inner block,
  // then closure variables. In the Global frame: module variables, then blocks.
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
      frame.note = `The heap could not be read in this frame: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const walkedVars = new Map<string, Value>();
  if (walked) {
    for (const v of walked.vars) walkedVars.set(v.name, v.value);
    for (const o of walked.objects) objects[o.id] = o;
    for (const id of walked.missing) missing.add(id);
  }

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
  return frame;
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
