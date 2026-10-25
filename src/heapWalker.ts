// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The heap walker runs INSIDE the paused program (through the request `Runtime.callFunctionOn` of V8, see
// src/snapshot.ts). It gets the values of the variables, not their names: V8 gives each variable of each scope with
// its value, so the walker also reads a variable that a variable of the same name in an inner block hides.
//
// Why: the debugger gives no stable id for an object. Two variables that point to the
// same array would look like two arrays. The walker keeps a WeakMap from object to id, so the same
// object always gets the same id, also from one step to the next.
//
// `installHeapWalker` is converted to source text with Function.prototype.toString, so it must not
// use anything from outside its own body. It is plain JavaScript with TypeScript types only.

import type { Value } from './model.ts';

export const WALKER_VERSION = 6;
export const GLOBAL_NAME = '__mindbug';

export interface WalkerLimits {
  /** Maximum number of heap objects described per frame. */
  objects: number;
  /** Maximum number of array items, set members or map entries per object. */
  items: number;
  /** Maximum number of fields per object. */
  fields: number;
  /** Maximum number of characters per string. */
  str: number;
}

export const DEFAULT_LIMITS: WalkerLimits = { objects: 300, items: 100, fields: 50, str: 200 };

/**
 * Installs `globalThis.__mindbug` in the program. Returns "installed" or "ready" (already there).
 * The api: begin(limits), v(name, value), end() -> JSON text.
 */
export function installHeapWalker(version: number, globalName: string): string {
  const g: any = globalThis;
  const existing = g[globalName];
  if (existing && existing.version === version) {
    return 'ready';
  }

  // Keep references to built-ins, so later changes by the program do not affect the walker.
  const O = Object;
  const getProto = O.getPrototypeOf;
  const getOwnDesc = O.getOwnPropertyDescriptor;
  const ownKeys = Reflect.ownKeys;
  const apply = Reflect.apply;
  const isArray = Array.isArray;
  const isView = ArrayBuffer.isView;
  const stringify = JSON.stringify;
  const objectIs = O.is;
  const WeakMapCtor = WeakMap;
  const SetCtor = Set;
  const fnToString = Function.prototype.toString;
  const mapEntries = Map.prototype.entries;
  const setValues = Set.prototype.values;
  const mapSize = (getOwnDesc(Map.prototype, 'size') as PropertyDescriptor).get as () => number;
  const setSize = (getOwnDesc(Set.prototype, 'size') as PropertyDescriptor).get as () => number;
  const dateGetTime = Date.prototype.getTime;
  const dateToIso = Date.prototype.toISOString;
  const reSource = (getOwnDesc(RegExp.prototype, 'source') as PropertyDescriptor).get as () => string;
  const reToString = RegExp.prototype.toString;
  const weakMapHas = WeakMap.prototype.has;
  const weakSetHas = WeakSet.prototype.has;
  const PromiseCtor = Promise;
  const errorProto = Error.prototype;

  const ids = new WeakMapCtor<object, number>();
  let nextId = 1;
  let limits = { objects: 300, items: 100, fields: 50, str: 200 };
  let cur: { vars: { name: string; value: Value }[]; seen: Set<number>; queue: object[] } | null = null;

  function brand(fn: Function, o: unknown): boolean {
    try {
      apply(fn, o, []);
      return true;
    } catch {
      return false;
    }
  }

  function idOf(o: object): number {
    let id = ids.get(o);
    if (id === undefined) {
      id = nextId++;
      ids.set(o, id);
    }
    return id;
  }

  function ref(o: object): Value {
    const id = idOf(o);
    if (cur && !cur.seen.has(id)) {
      cur.seen.add(id);
      cur.queue.push(o);
    }
    return { k: 'ref', id };
  }

  function enc(v: unknown): Value {
    switch (typeof v) {
      case 'number':
        return { k: 'num', v: objectIs(v, -0) ? '-0' : String(v) };
      case 'string':
        return v.length > limits.str ? { k: 'str', v: v.slice(0, limits.str), cut: true } : { k: 'str', v };
      case 'boolean':
        return { k: 'bool', v };
      case 'undefined':
        return { k: 'undef' };
      case 'bigint':
        return { k: 'big', v: String(v) + 'n' };
      case 'symbol':
        return { k: 'sym', v: String(v) };
      case 'object':
        return v === null ? { k: 'null' } : ref(v);
      case 'function':
        return ref(v);
    }
    return { k: 'unavail' };
  }

  function encDesc(d: PropertyDescriptor): Value {
    return 'value' in d ? enc(d.value) : { k: 'accessor', get: !!d.get, set: !!d.set };
  }

  function className(o: object): string {
    try {
      const p = getProto(o);
      if (p === null) {
        return 'Object';
      }
      const d = getOwnDesc(p, 'constructor');
      const c = d && 'value' in d ? d.value : undefined;
      if (typeof c === 'function') {
        const n = getOwnDesc(c, 'name');
        if (n && typeof n.value === 'string' && n.value) {
          return n.value;
        }
      }
    } catch {
      // A Proxy or an exotic object: use the default name.
    }
    return 'Object';
  }

  function isError(o: object): boolean {
    try {
      let p = getProto(o);
      while (p) {
        if (p === errorProto) {
          return true;
        }
        p = getProto(p);
      }
    } catch {
      // ignore
    }
    return false;
  }

  function isClassFn(f: unknown): boolean {
    if (typeof f !== 'function') return false;
    try {
      return /^class[\s{]/.test(String(apply(fnToString, f, [])));
    } catch {
      return false;
    }
  }

  /** The class (written with the `class` keyword) that made this object, or undefined. */
  function userClassOf(o: object): Function | undefined {
    try {
      const p = getProto(o);
      if (!p) return undefined;
      const d = getOwnDesc(p, 'constructor');
      const c = d && 'value' in d ? d.value : undefined;
      return isClassFn(c) ? c : undefined;
    } catch {
      return undefined;
    }
  }

  function memberName(key: string | symbol, d: PropertyDescriptor): string {
    const name = typeof key === 'symbol' ? '[' + String(key) + ']' : key;
    if ('value' in d) return name + '()';
    if (d.get && d.set) return 'get/set ' + name;
    return (d.get ? 'get ' : 'set ') + name;
  }

  /**
   * Names of the instance attributes that a class declares (`name;`, `age = 0;`), read from the
   * class source text. The TypeScript compiler and Node.js keep these declarations when they remove the types.
   * When the class declares none (plain JavaScript), the `this.x = ...` assignments are used.
   */
  function declaredAttributes(src: string): string[] {
    const names: string[] = [];
    const add = (n: string) => {
      if (n && names.indexOf(n) < 0) names.push(n);
    };
    const finish = (raw: string) => {
      let head = raw.trim();
      if (!head || /^static\b/.test(head)) return;
      head = head.replace(/^(?:(?:readonly|declare|public|protected|private|override|accessor)\s+)+/, '');
      const eq = head.indexOf('=');
      const paren = head.indexOf('(');
      if (paren >= 0 && (eq < 0 || paren < eq)) return; // a method, getter or setter
      let name = (eq >= 0 ? head.slice(0, eq) : head).replace(/[?!:].*$/s, '').trim();
      if (/^["'].*["']$/.test(name)) name = name.slice(1, -1);
      if (!name || name.charAt(0) === '#' || /[\s{}]/.test(name)) return;
      add(name);
    };
    let i = src.indexOf('{');
    if (i < 0) return names;
    i++;
    let depth = 1;
    let head = '';
    while (i < src.length && depth > 0) {
      const c = src.charAt(i);
      if (c === '"' || c === "'" || c === '`') {
        // Skip a string. In a template literal, `${ ... }` may contain more braces and strings,
        // which is rare in a class body; they are skipped as part of the string.
        let j = i + 1;
        let nested = 0;
        while (j < src.length) {
          const d = src.charAt(j);
          if (d === '\\') {
            j += 2;
            continue;
          }
          if (c === '`' && d === '$' && src.charAt(j + 1) === '{') {
            nested++;
            j += 2;
            continue;
          }
          if (nested > 0 && d === '}') nested--;
          else if (nested === 0 && d === c) break;
          j++;
        }
        if (depth === 1) head += src.slice(i, j + 1);
        i = j + 1;
        continue;
      }
      if (c === '/' && src.charAt(i + 1) === '/') {
        const nl = src.indexOf('\n', i);
        i = nl < 0 ? src.length : nl;
        continue;
      }
      if (c === '/' && src.charAt(i + 1) === '*') {
        const close = src.indexOf('*/', i + 2);
        i = close < 0 ? src.length : close + 2;
        continue;
      }
      if (c === '{' || c === '(' || c === '[') {
        if (depth === 1) head += c;
        depth++;
      } else if (c === '}' || c === ')' || c === ']') {
        depth--;
        if (depth === 1 && c === '}') {
          finish(head);
          head = '';
        }
      } else if (depth === 1) {
        if (c === ';') {
          finish(head);
          head = '';
        } else {
          head += c;
        }
      }
      i++;
    }
    if (names.length === 0) {
      const re = /\bthis\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) add(m[1]);
    }
    return names;
  }

  /** Static variables, static methods, methods and the superclass of a class. */
  function describeClass(c: Function, src: string, out: any): void {
    out.attrs = declaredAttributes(src).slice(0, limits.fields);
    out.fields = [];
    out.methods = [];
    let hidden = 0;
    for (const key of ownKeys(c)) {
      if (key === 'length' || key === 'name' || key === 'prototype') continue;
      const d = getOwnDesc(c, key);
      if (!d) continue;
      const isMethod = !d.enumerable && (!('value' in d) || typeof d.value === 'function');
      if (isMethod) {
        out.methods.push({ name: memberName(key, d), isStatic: true });
      } else if (out.fields.length < limits.fields) {
        out.fields.push({ name: typeof key === 'symbol' ? String(key) : key, value: encDesc(d) });
      } else {
        hidden++;
      }
    }
    const proto = (c as any).prototype;
    if (proto && typeof proto === 'object') {
      for (const key of ownKeys(proto)) {
        if (key === 'constructor') continue;
        const d = getOwnDesc(proto, key);
        if (!d) continue;
        if (!('value' in d) || typeof d.value === 'function') {
          out.methods.push({ name: memberName(key, d), isStatic: false });
        }
      }
    }
    if (out.methods.length > limits.fields) {
      hidden += out.methods.length - limits.fields;
      out.methods.length = limits.fields;
    }
    if (hidden > 0) out.more = hidden;
    const parent = getProto(c);
    if (isClassFn(parent)) {
      const r = ref(parent as object) as { id: number };
      out.superId = r.id;
    }
  }

  function describe(o: object): any {
    const out: any = { id: idOf(o), kind: 'object', type: 'Object' };
    try {
      if (o === g) {
        out.kind = 'value';
        out.type = 'globalThis';
        return out;
      }
      if (typeof o === 'function') {
        let src = '';
        try {
          src = String(apply(fnToString, o, []));
        } catch {
          src = '';
        }
        const nameDesc = getOwnDesc(o, 'name');
        const name = nameDesc && typeof nameDesc.value === 'string' ? nameDesc.value : '';
        const isClass = /^class[\s{]/.test(src);
        out.kind = isClass ? 'class' : 'function';
        out.type = name || (isClass ? '(anonymous class)' : '(anonymous)');
        let head = src;
        const brace = head.indexOf('{');
        const arrow = head.indexOf('=>');
        let end = head.length;
        if (brace >= 0) end = Math.min(end, brace);
        if (arrow >= 0) end = Math.min(end, arrow + 2);
        head = head.slice(0, end).replace(/\s+/g, ' ').trim();
        if (head.length > 80) head = head.slice(0, 79) + '…';
        out.text = head;
        if (isClass) describeClass(o as Function, src, out);
        return out;
      }
      const cls = userClassOf(o);
      if (cls) out.cls = (ref(cls) as { id: number }).id;
      if (isArray(o)) {
        const arr = o as unknown[];
        const n = arr.length;
        const m = Math.min(n, limits.items);
        out.kind = 'array';
        out.type = 'Array';
        out.length = n;
        out.items = [];
        for (let i = 0; i < m; i++) {
          const d = getOwnDesc(arr, i);
          out.items.push(d === undefined ? { k: 'hole' } : encDesc(d));
        }
        if (n > m) out.more = n - m;
        return out;
      }
      if (isView(o) && !(o instanceof DataView)) {
        const ta = o as unknown as ArrayLike<number | bigint>;
        const n = ta.length;
        const m = Math.min(n, limits.items);
        out.kind = 'array';
        out.type = className(o);
        out.length = n;
        out.items = [];
        for (let i = 0; i < m; i++) out.items.push(enc(ta[i]));
        if (n > m) out.more = n - m;
        return out;
      }
      if (brand(mapSize, o)) {
        out.kind = 'map';
        out.type = className(o);
        out.entries = [];
        const total = apply(mapSize, o, []) as number;
        const it = apply(mapEntries, o, []) as Iterator<[unknown, unknown]>;
        for (let i = 0; i < limits.items; i++) {
          const r = it.next();
          if (r.done) break;
          out.entries.push({ key: enc(r.value[0]), value: enc(r.value[1]) });
        }
        if (total > out.entries.length) out.more = total - out.entries.length;
        return out;
      }
      if (brand(setSize, o)) {
        out.kind = 'set';
        out.type = className(o);
        out.items = [];
        const total = apply(setSize, o, []) as number;
        const it = apply(setValues, o, []) as Iterator<unknown>;
        for (let i = 0; i < limits.items; i++) {
          const r = it.next();
          if (r.done) break;
          out.items.push(enc(r.value));
        }
        if (total > out.items.length) out.more = total - out.items.length;
        return out;
      }
      if (brand(dateGetTime, o)) {
        out.kind = 'value';
        out.type = 'Date';
        const t = apply(dateGetTime, o, []) as number;
        out.text = t === t ? String(apply(dateToIso, o, [])) : 'Invalid Date';
        return out;
      }
      if (brand(reSource, o)) {
        out.kind = 'value';
        out.type = 'RegExp';
        out.text = String(apply(reToString, o, []));
        return out;
      }
      if (brand(weakMapHas, o) || brand(weakSetHas, o)) {
        out.kind = 'value';
        out.type = className(o);
        out.text = 'contents not visible';
        return out;
      }
      if (o instanceof PromiseCtor) {
        out.kind = 'value';
        out.type = 'Promise';
        return out;
      }

      // A plain object or a class instance: UML object notation.
      out.type = className(o);
      out.fields = [];
      const err = isError(o);
      const keys = ownKeys(o);
      let shown = 0;
      let hidden = 0;
      for (const key of keys) {
        const d = getOwnDesc(o, key);
        if (!d) continue;
        const wanted = d.enumerable || (err && key === 'message');
        if (!wanted) continue;
        if (shown >= limits.fields) {
          hidden++;
          continue;
        }
        out.fields.push({ name: typeof key === 'symbol' ? String(key) : key, value: encDesc(d) });
        shown++;
      }
      if (hidden > 0) out.more = hidden;
      return out;
    } catch (e) {
      out.kind = 'value';
      out.text = 'cannot be read: ' + String(e);
      return out;
    }
  }

  const api = {
    version,
    begin(newLimits?: Partial<typeof limits>): void {
      if (newLimits) {
        limits = {
          objects: newLimits.objects ?? limits.objects,
          items: newLimits.items ?? limits.items,
          fields: newLimits.fields ?? limits.fields,
          str: newLimits.str ?? limits.str,
        };
      }
      cur = { vars: [], seen: new SetCtor<number>(), queue: [] };
    },
    v(name: string, value: unknown): void {
      if (cur) cur.vars.push({ name, value: enc(value) });
    },
    end(): string {
      const c = cur;
      if (!c) return '{}';
      const objects: any[] = [];
      let i = 0;
      while (i < c.queue.length && objects.length < limits.objects) {
        objects.push(describe(c.queue[i++]));
      }
      const missing: number[] = [];
      for (; i < c.queue.length; i++) missing.push(idOf(c.queue[i]));
      cur = null;
      return stringify({ v: version, vars: c.vars, objects, missing });
    },
  };
  O.defineProperty(g, globalName, { value: api, configurable: true, writable: true, enumerable: false });
  return 'installed';
}

/** The function that installs the walker, for `Runtime.callFunctionOn` with the arguments WALKER_VERSION and GLOBAL_NAME. */
export function installFunction(): string {
  return installHeapWalker.toString();
}

/** The result of `walkerFunction` when the walker is not installed in the program, or has another version. */
export const NOT_INSTALLED = 'mindbug: not installed';

/**
 * The function that reads the variables of one frame and returns the JSON text of the snapshot, for
 * `Runtime.callFunctionOn`. Its arguments are the limits and the values of the variables; the walker names the
 * variable of each value by its index ("0", "1", ...). Without the walker, it returns NOT_INSTALLED.
 */
export function walkerFunction(): string {
  const api = `globalThis.${GLOBAL_NAME}`;
  return [
    'function (limits, ...values) {',
    `  const api = ${api};`,
    `  if (api?.version !== ${WALKER_VERSION}) return ${JSON.stringify(NOT_INSTALLED)};`,
    '  api.begin(limits);',
    '  for (let i = 0; i < values.length; i++) api.v(String(i), values[i]);',
    '  return api.end();',
    '}',
  ].join('\n');
}

/** Raw result of the heap walker for one frame. */
export interface WalkerResult {
  v: number;
  vars: { name: string; value: Value }[];
  objects: import('./model.ts').HeapObject[];
  missing: number[];
}
