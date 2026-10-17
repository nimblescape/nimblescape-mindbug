// End-to-end test of the snapshot collector against a real Deno program, through Deno's V8 inspector.
// FakeDap answers the Debug Adapter Protocol requests the way VS Code's JavaScript debugger does.
//
// Needs Deno: set DENO_PATH, or have `deno` on the PATH. Without Deno the tests are skipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from '../../src/snapshot.ts';
import type { MemorySnapshot, Value } from '../../src/model.ts';
import { FakeDap } from './fakeDap.ts';
import { DenoInspector } from './inspector.ts';

const deno = process.env.DENO_PATH ?? 'deno';
const hasDeno = spawnSync(deno, ['--version']).status === 0;
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let port = 9400;

/** Runs a fixture and returns a snapshot at each `debugger;` statement. */
async function pauses(name: string, count: number): Promise<MemorySnapshot[]> {
  const insp = await DenoInspector.start(deno, join(fixtures, name), port++);
  const out: MemorySnapshot[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const ev = await insp.resumeToNextPause();
      out.push(await collectSnapshot(new FakeDap(insp, ev), 1, i + 1));
    }
  } finally {
    await insp.close();
  }
  return out;
}

function variable(s: MemorySnapshot, frame: string, name: string): Value {
  const f = s.frames.find((x) => x.name === frame);
  assert.ok(f, `frame ${frame}`);
  const v = f.vars.find((x) => x.name === name);
  assert.ok(v, `variable ${name} in ${frame}`);
  return v.value;
}

const idOf = (v: Value) => {
  assert.equal(v.k, 'ref');
  return (v as { id: number }).id;
};

test('insertion sort: frames, aliasing and stable ids', { skip: !hasDeno && 'Deno not found' }, async () => {
  const [inLoop, atEnd] = await pauses('sort.ts', 2);
  assert.deepEqual(
    inLoop.frames.map((f) => f.name),
    ['Global frame', 'insertionSort'],
  );
  assert.equal(inLoop.frames[1].line, 10);
  const arr = idOf(variable(inLoop, 'insertionSort', 'arr'));
  assert.equal(idOf(variable(inLoop, 'Global frame', 'arr2')), arr, 'arr and arr2 are the same array');
  assert.notEqual(idOf(variable(inLoop, 'Global frame', 'arr1')), arr);
  assert.deepEqual(variable(inLoop, 'insertionSort', 'unsortedIndex'), { k: 'num', v: '7' });
  assert.equal(idOf(variable(atEnd, 'Global frame', 'arr2')), arr, 'the id stays the same in the next step');
  assert.deepEqual(
    atEnd.objects[arr].items!.map((v) => (v as { v: string }).v),
    ['-4', '1', '3', '3', '4', '5', '6', '7'],
  );
});

test('objects: getters are not called, closures, uninitialized let', { skip: !hasDeno && 'Deno not found' }, async () => {
  const [inBirthday, inCounter, atEnd] = await pauses('objects.ts', 3);
  const ann = idOf(variable(inBirthday, 'birthday', 'this'));
  assert.equal(idOf(variable(inBirthday, 'Global frame', 'ann')), ann);
  const fields = inBirthday.objects[ann].fields!;
  assert.deepEqual(fields.find((f) => f.name === 'age')?.value, { k: 'num', v: '24' });
  assert.deepEqual(fields.find((f) => f.name === 'secretCount')?.value, { k: 'num', v: '0' }, 'the getter did not run');
  const count = inCounter.frames.at(-1)!.vars.find((v) => v.name === 'count');
  assert.equal(count?.scope, 'closure');
  assert.deepEqual(variable(atEnd, 'Global frame', 'later'), { k: 'uninit' });
});

test('classes: class boxes with static variables, attributes, methods and superclass', { skip: !hasDeno && 'Deno not found' }, async () => {
  const [s] = await pauses('classes.ts', 1);
  const ann = s.objects[idOf(variable(s, 'Global frame', 'ann'))];
  const bob = s.objects[idOf(variable(s, 'Global frame', 'bob'))];
  const person = s.objects[ann.cls!];
  const student = s.objects[bob.cls!];
  assert.equal(person.type, 'Person');
  assert.equal(idOf(variable(s, 'Global frame', 'Person')), person.id);
  assert.deepEqual(person.attrs, ['name', 'age']);
  assert.deepEqual(
    person.fields!.map((f) => [f.name, f.value.k]),
    [
      ['count', 'num'],
      ['species', 'str'],
      ['registry', 'ref'],
    ],
  );
  assert.deepEqual(person.fields![0].value, { k: 'num', v: '2' });
  assert.deepEqual(
    person.methods!.map((m) => m.name),
    ['reset()', 'birthday()', 'get label'],
  );
  assert.equal(student.superId, person.id);
  assert.deepEqual(student.attrs, ['school'], 'a constructor parameter property is a declared field');
  const birthday = s.frames.find((f) => f.name === 'birthday')!;
  assert.deepEqual(
    birthday.vars.map((v) => v.name),
    ['this'],
    "the class's own name binding is not shown as a variable of the method",
  );
});
