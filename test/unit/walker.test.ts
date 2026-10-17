// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The heap walker runs inside the debugged program. Node uses the same V8 engine as Deno,
// so these tests install the walker in this Node process and read local variables with it.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS, frameExpression, installExpression, isIdentifier, type WalkerResult } from '../../src/heapWalker.ts';
import type { HeapObject } from '../../src/model.ts';

(0, eval)(installExpression());

function byId(r: WalkerResult): Record<number, HeapObject> {
  return Object.fromEntries(r.objects.map((o) => [o.id, o]));
}

function varOf(r: WalkerResult, name: string) {
  const v = r.vars.find((x) => x.name === name);
  assert.ok(v, `variable ${name}`);
  return v.value;
}

test('install is done once per version', () => {
  assert.equal((0, eval)(installExpression()), 'ready');
});

test('two variables that point to the same array get the same id, also in the next step', () => {
  const arr = [3, 1, 2];
  const alias = arr;
  const other = [3, 1, 2];
  const read = (): WalkerResult => JSON.parse(eval(frameExpression(['arr', 'alias', 'other'], DEFAULT_LIMITS)));
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
  void alias;
  void other;
});

test('values: numbers, strings, holes, map, set, cut strings', () => {
  const values = { negZero: -0, nan: NaN, big: 10n, nothing: null, long: 'x'.repeat(300) };
  const sparse = [1, , 3];
  const scores = new Map([['ann', 3]]);
  const tags = new Set(['a']);
  const r: WalkerResult = JSON.parse(
    eval(frameExpression(['values', 'sparse', 'scores', 'tags'], { ...DEFAULT_LIMITS, str: 10 })),
  );
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
  const r: WalkerResult = JSON.parse(eval(frameExpression(['obj'], DEFAULT_LIMITS)));
  assert.equal(calls, 0);
  const o = byId(r)[(varOf(r, 'obj') as { id: number }).id];
  assert.deepEqual(o.fields![0].value, { k: 'accessor', get: true, set: false });
});

test('a let before its declaration is uninitialized', () => {
  const read = () => JSON.parse(eval(frameExpression(['later'], DEFAULT_LIMITS))) as WalkerResult;
  const r = read();
  let later = 5;
  assert.deepEqual(varOf(r, 'later'), { k: 'uninit' });
  void later;
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
  const r: WalkerResult = JSON.parse(eval(frameExpression(['ann', 'bob'], DEFAULT_LIMITS)));
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
  const r: WalkerResult = JSON.parse(eval(frameExpression(['p'], DEFAULT_LIMITS)));
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
  const r: WalkerResult = JSON.parse(eval(frameExpression(['o'], DEFAULT_LIMITS)));
  const objs = byId(r);
  const cls = objs[objs[(varOf(r, 'o') as { id: number }).id].cls!];
  assert.deepEqual(cls.attrs, ['a', 'handler', 'quoted', 'd']);
});

test('plain objects and arrays have no class', () => {
  const plain = { a: 1 };
  const list = [1];
  const r: WalkerResult = JSON.parse(eval(frameExpression(['plain', 'list'], DEFAULT_LIMITS)));
  for (const o of r.objects) assert.equal(o.cls, undefined);
});

test('isIdentifier', () => {
  assert.ok(isIdentifier('arr2'));
  assert.ok(isIdentifier('this'));
  assert.ok(isIdentifier('$x_ä'));
  assert.ok(!isIdentifier('a-b'));
  assert.ok(!isIdentifier('2x'));
});
