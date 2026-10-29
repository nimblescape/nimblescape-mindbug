// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The heap walker runs inside the debugged program, a Node.js process, so these tests install the walker in this
// Node.js process and give it values, as Runtime.callFunctionOn does.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMITS,
  GLOBAL_NAME,
  installFunction,
  NOT_INSTALLED,
  WALKER_VERSION,
  walkerFunction,
  type WalkerLimits,
  type WalkerResult,
} from '../../src/heapWalker.ts';
import type { HeapObject } from '../../src/model.ts';
import { parseWalkerResult } from '../../src/snapshot.ts';

const install = (): string => (0, eval)(`(${installFunction()})(${WALKER_VERSION}, ${JSON.stringify(GLOBAL_NAME)})`);
install();
const walker = (0, eval)(`(${walkerFunction()})`) as (limits: WalkerLimits, ...values: unknown[]) => string;

/** The result of the walker (JSON text). */
function parsed(text: string): WalkerResult {
  const result = parseWalkerResult(text);
  assert.ok(result, 'a complete result');
  return result;
}

/** Runs the walker for the values, as Runtime.callFunctionOn does, and gives each result the name of its value. */
function walk(values: Record<string, unknown>, limits: WalkerLimits = DEFAULT_LIMITS): WalkerResult {
  const names = Object.keys(values);
  const r = parsed(walker(limits, ...Object.values(values)));
  return { ...r, vars: r.vars.map((v) => ({ ...v, name: names[Number(v.name)] })) };
}

function byId(r: WalkerResult): Record<number, HeapObject> {
  return Object.fromEntries(r.objects.map((o) => [o.id, o]));
}

function varOf(r: WalkerResult, name: string) {
  const v = r.vars.find((x) => x.name === name);
  assert.ok(v, `variable ${name}`);
  return v.value;
}

test('install is done once per version', () => {
  assert.equal(install(), 'ready');
});

test('without the walker, the walker function says so', () => {
  const g = globalThis as Record<string, unknown>;
  const api = g[GLOBAL_NAME];
  try {
    delete g[GLOBAL_NAME];
    assert.equal(walker(DEFAULT_LIMITS, 1), NOT_INSTALLED);
    // A walker of another version is not used either.
    g[GLOBAL_NAME] = { version: 1 };
    assert.equal(walker(DEFAULT_LIMITS, 1), NOT_INSTALLED);
    Object.defineProperty(g, GLOBAL_NAME, { value: api, configurable: true, writable: true, enumerable: false });
    assert.deepEqual(parsed(walker(DEFAULT_LIMITS, 1)).vars, [{ name: '0', value: { k: 'num', v: '1' } }]);
  } finally {
    Object.defineProperty(g, GLOBAL_NAME, { value: api, configurable: true, writable: true, enumerable: false });
  }
});

test('two values with the same name in the program are two variables of the walker', () => {
  // A block hides the outer variable of the same name from its code; V8 gives both values, by their scopes.
  const outer = { x: 10 };
  const inner = { x: 200 };
  const r = parsed(walker(DEFAULT_LIMITS, inner, outer));
  const [first, second] = r.vars.map((v) => (v.value as { id: number }).id);
  assert.notEqual(first, second);
  assert.deepEqual(byId(r)[second].fields?.[0], { name: 'x', value: { k: 'num', v: '10' } });
});

test('the result is the JSON text of the snapshot, also with characters outside the BMP', () => {
  const words = ['😀😀😀', 'ä'.repeat(7)];
  const text = walker(DEFAULT_LIMITS, words);
  const r = parsed(text);
  assert.equal(text, JSON.stringify(r));
  const items = byId(r)[(varOf(r, '0') as { id: number }).id].items;
  assert.deepEqual(items, [
    { k: 'str', v: words[0] },
    { k: 'str', v: words[1] },
  ]);
});

test('two variables that point to the same array get the same id, also in the next step', () => {
  const arr = [3, 1, 2];
  const alias = arr;
  const other = [3, 1, 2];
  const read = (): WalkerResult => walk({ arr, alias, other });
  const first = read();
  const a = varOf(first, 'arr');
  assert.equal(a.k, 'ref');
  assert.deepEqual(varOf(first, 'alias'), a);
  assert.notDeepEqual(varOf(first, 'other'), a);
  arr.push(4);
  const second = read();
  assert.deepEqual(varOf(second, 'arr'), a);
  const o = byId(second)[(a as { id: number }).id];
  assert.equal(o.kind, 'array');
  assert.equal(o.length, 4);
});

test('values: numbers, strings, holes, map, set, cut strings', () => {
  const values = { negZero: -0, nan: NaN, big: 10n, nothing: null, long: 'x'.repeat(300) };
  // An array with a hole, which the walker shows as a hole.
  // eslint-disable-next-line no-sparse-arrays
  const sparse = [1, , 3];
  const scores = new Map([['ann', 3]]);
  const tags = new Set(['a']);
  const r = walk({ values, sparse, scores, tags }, { ...DEFAULT_LIMITS, str: 10 });
  const objs = byId(r);
  const v = objs[(varOf(r, 'values') as { id: number }).id];
  const field = (n: string) => v.fields!.find((f) => f.name === n)!.value;
  assert.deepEqual(field('negZero'), { k: 'num', v: '-0' });
  assert.deepEqual(field('nan'), { k: 'num', v: 'NaN' });
  assert.deepEqual(field('big'), { k: 'big', v: '10n' });
  assert.deepEqual(field('nothing'), { k: 'null' });
  assert.deepEqual(field('long'), { k: 'str', v: 'xxxxxxxxxx', cut: true });
  assert.deepEqual(objs[(varOf(r, 'sparse') as { id: number }).id].items![1], { k: 'hole' });
  const m = objs[(varOf(r, 'scores') as { id: number }).id];
  assert.equal(m.kind, 'map');
  assert.deepEqual(m.entries, [{ key: { k: 'str', v: 'ann' }, value: { k: 'num', v: '3' } }]);
  assert.equal(objs[(varOf(r, 'tags') as { id: number }).id].kind, 'set');
});

test('getters are not called', () => {
  let calls = 0;
  const obj = {
    get secret() {
      calls++;
      return 1;
    },
  };
  const r = walk({ obj });
  assert.equal(calls, 0);
  const o = byId(r)[(varOf(r, 'obj') as { id: number }).id];
  assert.deepEqual(o.fields![0].value, { k: 'accessor', get: true, set: false });
});

test('undefined stays undefined', () => {
  // A variable without a value (a let before its line) does not go to the walker: the snapshot shows it as
  // uninitialized. A variable with the value undefined does.
  assert.deepEqual(varOf(walk({ nothing: undefined }), 'nothing'), { k: 'undef' });
});

test('classes: static variables, attributes, methods, superclass, and the class of each object', () => {
  class Person {
    static count = 0;
    static registry: Person[] = [];
    name;
    age = 0;
    #secret = 1;
    constructor(name: string) {
      this.name = name;
      Person.count++;
      Person.registry.push(this);
    }
    birthday(): void {
      this.age++;
    }
    get label(): string {
      return `${this.name} ${this.#secret}`;
    }
    static reset(): void {
      Person.count = 0;
    }
  }
  class Student extends Person {
    school = 'HTL';
  }
  const ann = new Person('Ann');
  const bob = new Student('Bob');
  const r = walk({ ann, bob });
  const objs = byId(r);
  const annObj = objs[(varOf(r, 'ann') as { id: number }).id];
  const bobObj = objs[(varOf(r, 'bob') as { id: number }).id];
  assert.equal(annObj.type, 'Person');
  assert.ok(annObj.cls !== undefined);
  const person = objs[annObj.cls!];
  const student = objs[bobObj.cls!];
  assert.equal(person.kind, 'class');
  assert.equal(person.type, 'Person');
  assert.deepEqual(person.attrs, ['name', 'age']);
  assert.deepEqual(
    person.fields!.map((f) => f.name),
    ['count', 'registry'],
  );
  assert.deepEqual(person.fields![0].value, { k: 'num', v: '2' });
  assert.equal(person.fields![1].value.k, 'ref');
  assert.deepEqual(person.methods, [
    { name: 'reset()', isStatic: true },
    { name: 'birthday()', isStatic: false },
    { name: 'get label', isStatic: false },
  ]);
  assert.equal(student.type, 'Student');
  assert.equal(student.superId, person.id);
  assert.deepEqual(student.attrs, ['school']);
  assert.deepEqual(student.fields, []);
});

test('a class without declared fields lists the attributes that the code assigns', () => {
  const Point = (0, eval)('(class Point { constructor(x, y) { this.x = x; this.y = y; } move() { this.x += 1; } })');
  const p = new Point(1, 2);
  const r = walk({ p });
  const objs = byId(r);
  const cls = objs[objs[(varOf(r, 'p') as { id: number }).id].cls!];
  assert.deepEqual(cls.attrs, ['x', 'y']);
});

test('field declarations with strings, arrow functions and comments are read correctly', () => {
  const Odd = (0, eval)(`(class Odd {
    a = '{ not a brace';
    // b = 1;
    /* c = 2; */
    handler = () => { return 1; };
    "quoted" = 3;
    d = \`x \${1 + 1} {\`;
    method() { const e = 1; return e; }
  })`);
  const o = new Odd();
  const r = walk({ o });
  const objs = byId(r);
  const cls = objs[objs[(varOf(r, 'o') as { id: number }).id].cls!];
  assert.deepEqual(cls.attrs, ['a', 'handler', 'quoted', 'd']);
});

test('plain objects and arrays have no class', () => {
  const plain = { a: 1 };
  const list = [1];
  const r = walk({ plain, list });
  for (const o of r.objects) assert.equal(o.cls, undefined);
});

test('a program that replaces built-in methods changes nothing that the walker reads, and none of them runs', () => {
  // A lesson on prototypes can replace Array.prototype.push or add Object.prototype.toJSON. The walker saved the
  // built-in functions at its install and calls none of the replaced ones. (It reads the text of functions and classes
  // with the methods of strings, so they are not replaced here.)
  class Shape {
    static count = 1;
    name = 'square';
    get area(): number {
      return 4;
    }
    grow(): void {}
  }
  const args: unknown[] = [
    [1, [2, 3]],
    new Map([['a', { b: 1 }]]),
    new Set(['c']),
    new Shape(),
    new Uint8Array([4, 5]),
    new DataView(new ArrayBuffer(2)),
    Promise.resolve(1),
    new Error('boom'),
    'x'.repeat(300),
  ];
  const limits = { ...DEFAULT_LIMITS, str: 10 };
  const read = () => walker(limits, args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8]);
  const before = read();

  // The replacements record their calls without the methods that they replace.
  const calls: string[] = [];
  const record = (label: string) => {
    calls[calls.length] = label;
  };
  const patches: [object, PropertyKey, PropertyDescriptor | undefined][] = [];
  const patch = (
    target: object,
    key: PropertyKey,
    make: (original: (...args: unknown[]) => unknown) => PropertyDescriptor,
  ) => {
    const original = Object.getOwnPropertyDescriptor(target, key);
    patches[patches.length] = [target, key, original];
    Object.defineProperty(target, key, { configurable: true, ...make(original?.value) });
  };
  const replace = (target: object, key: PropertyKey, label: string) =>
    patch(target, key, (original) => ({
      writable: true,
      value(this: unknown, ...a: unknown[]) {
        record(label);
        return Reflect.apply(original, this, a);
      },
    }));
  const hasInstance = (ctor: abstract new (...args: never[]) => unknown) =>
    patch(ctor, Symbol.hasInstance, () => ({
      value: () => {
        record(`${ctor.name}[Symbol.hasInstance]`);
        return false;
      },
    }));
  hasInstance(Promise);
  hasInstance(DataView);
  patch(Object.prototype, 'toJSON', () => ({
    writable: true,
    value: () => {
      record('Object.prototype.toJSON');
      return 'changed';
    },
  }));
  replace(Set.prototype, 'has', 'Set.prototype.has');
  replace(Set.prototype, 'add', 'Set.prototype.add');
  replace(WeakMap.prototype, 'get', 'WeakMap.prototype.get');
  replace(WeakMap.prototype, 'set', 'WeakMap.prototype.set');
  replace(Object.getPrototypeOf(new Map().entries()), 'next', 'next of a map iterator');
  replace(Object.getPrototypeOf(new Set().values()), 'next', 'next of a set iterator');
  replace(Object.getPrototypeOf([][Symbol.iterator]()), 'next', 'next of an array iterator');
  replace(Array.prototype, Symbol.iterator, 'Array.prototype[Symbol.iterator]');
  replace(Array.prototype, 'indexOf', 'Array.prototype.indexOf');
  replace(Array.prototype, 'push', 'Array.prototype.push');
  // A getter "value" of Object.prototype would run for the descriptor of a getter of the program, which has no value.
  patch(Object.prototype, 'value', () => ({
    get: () => {
      record('Object.prototype.value');
      return 'changed';
    },
  }));
  let after: string;
  let during: string[];
  try {
    calls.length = 0;
    after = read();
    during = calls.slice();
  } finally {
    for (let i = patches.length - 1; i >= 0; i--) {
      const [target, key, original] = patches[i];
      if (original) Object.defineProperty(target, key, original);
      else delete (target as Record<PropertyKey, unknown>)[key];
    }
  }
  assert.deepEqual(during, []);
  assert.equal(after, before);
  const r = parsed(after);
  assert.deepEqual(r.vars[8].value, { k: 'str', v: 'xxxxxxxxxx', cut: true });
  assert.equal(byId(r)[(r.vars[5].value as { id: number }).id].kind, 'object', 'a DataView is no array');
  assert.equal(byId(r)[(r.vars[6].value as { id: number }).id].type, 'Promise');
});
