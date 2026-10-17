import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_VIEW_OPTIONS, layoutHeap, visibleVars } from '../../webview/layout.ts';
import type { HeapObject, MemorySnapshot, Variable } from '../../src/model.ts';

const ref = (id: number) => ({ k: 'ref', id }) as const;
const num = (v: number) => ({ k: 'num', v: String(v) }) as const;

function snapshot(vars: Variable[], objects: HeapObject[]): MemorySnapshot {
  return {
    step: 1,
    frames: [{ frameId: 0, name: 'Global scope', isGlobal: true, line: 1, vars }],
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    missing: [],
  };
}

const v = (name: string, value: Variable['value']): Variable => ({ name, value, scope: 'module' });

test('rows start at objects of frame variables; a shared object is placed once', () => {
  const s = snapshot(
    [v('a', ref(1)), v('b', ref(1)), v('c', ref(2))],
    [
      { id: 1, kind: 'array', type: 'Array', items: [ref(3), num(1)] },
      { id: 2, kind: 'object', type: 'Object', fields: [{ name: 'x', value: ref(3) }] },
      { id: 3, kind: 'object', type: 'Object', fields: [] },
    ],
  );
  const { rows, classes } = layoutHeap(s, DEFAULT_VIEW_OPTIONS);
  assert.deepEqual(classes, []);
  assert.deepEqual(rows, [
    { id: 1, children: [{ id: 3, children: [] }] },
    { id: 2, children: [] },
  ]);
});

test('a long chain starts a new row after maxDepth objects', () => {
  const objects: HeapObject[] = [];
  for (let i = 1; i <= 5; i++) {
    objects.push({ id: i, kind: 'object', type: 'Node', fields: i < 5 ? [{ name: 'next', value: ref(i + 1) }] : [] });
  }
  const { rows } = layoutHeap(snapshot([v('head', ref(1))], objects), DEFAULT_VIEW_OPTIONS, 3);
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 4],
  );
});

test('the heap builds bottom up: the rows of a newer scope are above the rows of the Global scope', () => {
  const s = snapshot(
    [v('a', ref(1)), v('b', ref(2))],
    [
      { id: 1, kind: 'array', type: 'Array', items: [] },
      { id: 2, kind: 'array', type: 'Array', items: [] },
      { id: 3, kind: 'object', type: 'Object', fields: [] },
      { id: 4, kind: 'object', type: 'Object', fields: [] },
    ],
  );
  s.frames.push({
    frameId: 1,
    name: 'f',
    isGlobal: false,
    line: 2,
    vars: [v('x', ref(3)), v('y', ref(4)), v('z', ref(1))],
  });
  const { rows } = layoutHeap(s, DEFAULT_VIEW_OPTIONS);
  // The Global scope is at the bottom; the rows of one scope keep the order of its variables;
  // the array that both scopes point to stays in the rows of the Global scope.
  assert.deepEqual(
    rows.map((r) => r.id),
    [3, 4, 1, 2],
  );
});

test('classes: superclass first, class variables hidden, static references start rows', () => {
  const s = snapshot(
    [v('Student', ref(10)), v('Person', ref(11)), v('bob', ref(1)), v('f', ref(20))],
    [
      { id: 1, kind: 'object', type: 'Student', cls: 10, fields: [{ name: 'age', value: num(19) }] },
      { id: 10, kind: 'class', type: 'Student', superId: 11, fields: [] },
      { id: 11, kind: 'class', type: 'Person', fields: [{ name: 'all', value: ref(12) }] },
      { id: 12, kind: 'array', type: 'Array', items: [ref(1)] },
      { id: 20, kind: 'function', type: 'f' },
    ],
  );
  const opts = DEFAULT_VIEW_OPTIONS;
  assert.deepEqual(
    visibleVars(s.frames[0], s, opts).map((x) => x.name),
    ['bob'],
  );
  const { rows, classes } = layoutHeap(s, opts);
  assert.deepEqual(classes, [11, 10]);
  // The rows that only a static variable reaches are at the top, below the classes.
  assert.deepEqual(
    rows.map((r) => r.id),
    [12, 1],
  );
});

test('with classes hidden, there are no class boxes', () => {
  const s = snapshot(
    [v('bob', ref(1))],
    [
      { id: 1, kind: 'object', type: 'Student', cls: 10, fields: [] },
      { id: 10, kind: 'class', type: 'Student', fields: [] },
    ],
  );
  const { rows, classes } = layoutHeap(s, { ...DEFAULT_VIEW_OPTIONS, showClasses: false });
  assert.deepEqual(classes, []);
  assert.deepEqual(rows, [{ id: 1, children: [] }]);
});

test('"Show functions" shows the variables that hold functions and classes', () => {
  const s = snapshot(
    [v('Person', ref(11)), v('f', ref(20))],
    [
      { id: 11, kind: 'class', type: 'Person', fields: [] },
      { id: 20, kind: 'function', type: 'f' },
    ],
  );
  const opts = { ...DEFAULT_VIEW_OPTIONS, showFunctions: true };
  assert.deepEqual(
    visibleVars(s.frames[0], s, opts).map((x) => x.name),
    ['Person', 'f'],
  );
  const { rows, classes } = layoutHeap(s, opts);
  assert.deepEqual(classes, [11]);
  assert.deepEqual(
    rows.map((r) => r.id),
    [20],
  );
});
