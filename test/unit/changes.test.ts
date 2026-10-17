import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChanges, slotKey, varKey } from '../../src/changes.ts';
import type { MemorySnapshot } from '../../src/model.ts';

const base = (): MemorySnapshot => ({
  step: 1,
  frames: [
    {
      frameId: 0,
      name: 'Global frame',
      isGlobal: true,
      line: 1,
      vars: [
        { name: 'i', value: { k: 'num', v: '1' }, scope: 'module' },
        { name: 'arr', value: { k: 'ref', id: 1 }, scope: 'module' },
      ],
    },
  ],
  objects: {
    1: { id: 1, kind: 'array', type: 'Array', items: [{ k: 'num', v: '3' }, { k: 'num', v: '1' }] },
    5: { id: 5, kind: 'class', type: 'Person', fields: [{ name: 'count', value: { k: 'num', v: '0' } }] },
  },
  missing: [],
});

test('no previous step: nothing is marked', () => {
  const c = computeChanges(undefined, base());
  assert.equal(c.vars.size + c.slots.size + c.newObjects.size, 0);
});

test('changed variable, array cell, static variable and new object', () => {
  const prev = base();
  const next = base();
  next.frames[0].vars[0].value = { k: 'num', v: '2' };
  next.objects[1].items![1] = { k: 'num', v: '3' };
  next.objects[5].fields![0].value = { k: 'num', v: '1' };
  next.objects[7] = { id: 7, kind: 'object', type: 'Object', fields: [] };
  const c = computeChanges(prev, next);
  assert.deepEqual([...c.vars], [varKey(0, 'Global frame', 'i')]);
  assert.deepEqual([...c.slots].sort(), [slotKey(1, '1'), slotKey(5, '.count')].sort());
  assert.deepEqual([...c.newObjects], [7]);
});

test('a new function call marks none of its variables', () => {
  const prev = base();
  const next = base();
  next.frames.push({ frameId: 1, name: 'sort', isGlobal: false, line: 3, vars: [{ name: 'x', value: { k: 'num', v: '1' }, scope: 'local' }] });
  assert.equal(computeChanges(prev, next).vars.size, 0);
});

test('an object that was not read before (object limit) is not marked as new', () => {
  const prev = base();
  prev.missing = [7];
  const next = base();
  next.objects[7] = { id: 7, kind: 'object', type: 'Object', fields: [] };
  assert.equal(computeChanges(prev, next).newObjects.size, 0);
});
