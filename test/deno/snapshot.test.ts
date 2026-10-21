// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// End-to-end test of the snapshot collector against a real Deno program, through Deno's V8 inspector.
// FakeDap answers the Debug Adapter Protocol requests the way VS Code's JavaScript debugger does.
//
// Needs Deno: set DENO_PATH, or have `deno` on the PATH. Without Deno the tests are skipped.
// npm run test:deno (vitest.deno.config.mts); `npm test` does not run them.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from '../../src/snapshot.ts';
import type { MemorySnapshot, Value } from '../../src/model.ts';
import { DEFAULT_LIMITS } from '../../src/heapWalker.ts';
import { FakeDap, RoundCounter } from './fakeDap.ts';
import { DenoInspector } from './inspector.ts';

const deno = process.env.DENO_PATH ?? 'deno';
const hasDeno = spawnSync(deno, ['--version']).status === 0;
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let port = 9400;

/**
 * Runs a fixture and returns a snapshot at each `debugger;` statement, with the number of rounds of requests that it
 * needed. `steps` gives the number of the step of each pause (1, 2, 3, … by default).
 */
async function pausesWithRounds(
  name: string,
  count: number,
  options: { steps?: number[]; limits?: typeof DEFAULT_LIMITS } = {},
): Promise<{ snapshot: MemorySnapshot; rounds: number }[]> {
  const insp = await DenoInspector.start(deno, join(fixtures, name), port++);
  const out: { snapshot: MemorySnapshot; rounds: number }[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const ev = await insp.resumeToNextPause();
      const dap = new RoundCounter(new FakeDap(insp, ev));
      const snapshot = await collectSnapshot(dap, 1, options.steps?.[i] ?? i + 1, { limits: options.limits });
      out.push({ snapshot, rounds: dap.rounds });
    }
  } finally {
    await insp.close();
  }
  return out;
}

/** Runs a fixture and returns a snapshot at each `debugger;` statement. */
async function pauses(name: string, count: number): Promise<MemorySnapshot[]> {
  return (await pausesWithRounds(name, count)).map((p) => p.snapshot);
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

test.skipIf(!hasDeno)('insertion sort: frames, aliasing and stable ids', async () => {
  const [inLoop, atEnd] = await pauses('sort.ts', 2);
  assert.deepEqual(
    inLoop.frames.map((f) => f.name),
    ['Global scope', 'insertionSort'],
  );
  assert.equal(inLoop.frames[1].line, 14);
  const arr = idOf(variable(inLoop, 'insertionSort', 'arr'));
  assert.equal(idOf(variable(inLoop, 'Global scope', 'arr2')), arr, 'arr and arr2 are the same array');
  assert.notEqual(idOf(variable(inLoop, 'Global scope', 'arr1')), arr);
  assert.deepEqual(variable(inLoop, 'insertionSort', 'unsortedIndex'), { k: 'num', v: '7' });
  assert.equal(idOf(variable(atEnd, 'Global scope', 'arr2')), arr, 'the id stays the same in the next step');
  assert.deepEqual(
    atEnd.objects[arr].items!.map((v) => (v as { v: string }).v),
    ['-4', '1', '3', '3', '4', '5', '6', '7'],
  );
});

test.skipIf(!hasDeno)('objects: getters are not called, closures, uninitialized let', async () => {
  const [inBirthday, inCounter, atEnd] = await pauses('objects.ts', 3);
  const ann = idOf(variable(inBirthday, 'Person.birthday', 'this'));
  assert.equal(idOf(variable(inBirthday, 'Global scope', 'ann')), ann);
  const fields = inBirthday.objects[ann].fields!;
  assert.deepEqual(fields.find((f) => f.name === 'age')?.value, { k: 'num', v: '24' });
  assert.deepEqual(fields.find((f) => f.name === 'secretCount')?.value, { k: 'num', v: '0' }, 'the getter did not run');
  const count = inCounter.frames.at(-1)!.vars.find((v) => v.name === 'count');
  assert.equal(count?.scope, 'closure');
  assert.deepEqual(variable(atEnd, 'Global scope', 'later'), { k: 'uninit' });
});

test.skipIf(!hasDeno)('classes: class boxes with static variables, attributes, methods and superclass', async () => {
  const [s] = await pauses('classes.ts', 1);
  const ann = s.objects[idOf(variable(s, 'Global scope', 'ann'))];
  const bob = s.objects[idOf(variable(s, 'Global scope', 'bob'))];
  const person = s.objects[ann.cls!];
  const student = s.objects[bob.cls!];
  assert.equal(person.type, 'Person');
  assert.equal(idOf(variable(s, 'Global scope', 'Person')), person.id);
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
  const birthday = s.frames.find((f) => f.name === 'Person.birthday')!;
  assert.deepEqual(
    birthday.vars.map((v) => v.name),
    ['this'],
    "the class's own name binding is not shown as a variable of the method",
  );
});

test.skipIf(!hasDeno)('names: the variables t, e, r, n, i and o, in four rounds of requests for three scopes', async () => {
  const [inLoop, atEnd] = await pausesWithRounds('names.ts', 2);
  assert.deepEqual(
    inLoop.snapshot.frames.map((f) => f.name),
    ['Global scope', 'outer', 'inner'],
  );
  assert.deepEqual(variable(inLoop.snapshot, 'outer', 't'), { k: 'str', v: 'tea' });
  assert.deepEqual(variable(inLoop.snapshot, 'outer', 'e'), { k: 'str', v: 'tea!' });
  assert.deepEqual(variable(inLoop.snapshot, 'inner', 'o'), { k: 'str', v: 'tea!' });
  assert.deepEqual(variable(inLoop.snapshot, 'inner', 'i'), { k: 'num', v: '1' });
  assert.deepEqual(variable(inLoop.snapshot, 'inner', 'r'), { k: 'num', v: '10' });
  const n = inLoop.snapshot.objects[idOf(variable(inLoop.snapshot, 'inner', 'n'))];
  assert.deepEqual(
    n.fields?.map((f) => [f.name, f.value]),
    [
      ['o', { k: 'str', v: 'tea!' }],
      ['r', { k: 'num', v: '10' }],
    ],
  );
  // The stack trace, the scopes of the three frames (the first step also installs the heap walker), their variables,
  // and the heap walker in the three frames.
  assert.equal(inLoop.rounds, 4);
  assert.equal(atEnd.rounds, 4);
  assert.equal(inLoop.snapshot.fallback, false);
});

test.skipIf(!hasDeno)('a new program in the same session: the heap walker is installed when it is missing', async () => {
  // A step after the first one, as after a restart of the program in the same debug session.
  const [first] = await pausesWithRounds('names.ts', 1, { steps: [5] });
  assert.deepEqual(variable(first.snapshot, 'inner', 'i'), { k: 'num', v: '1' });
  assert.equal(first.snapshot.fallback, false);
  // Four rounds, then the install, then the heap walker again.
  assert.equal(first.rounds, 6);
});

test.skipIf(!hasDeno)('a result longer than the debugger gives back is read in parts', async () => {
  const [s] = await pausesWithRounds('long.ts', 1, { limits: { ...DEFAULT_LIMITS, str: 2000 } });
  const words = s.snapshot.objects[idOf(variable(s.snapshot, 'Global scope', 'words'))];
  assert.equal(words.items?.length, 100);
  words.items!.forEach((item, i) => assert.deepEqual(item, { k: 'str', v: `${i}:` + 'ä😀'.repeat(400) }));
  // Four rounds, then all parts of the text at the same time.
  assert.equal(s.rounds, 5);
});

test.skipIf(!hasDeno)('exported names before their lines have run are uninitialized, and the program goes on', async () => {
  // Reading such a name with `typeof` stopped Deno ("abort: Unexpected instance type encountered").
  const insp = await DenoInspector.start(deno, join(fixtures, 'exports.ts'), port++, true);
  try {
    let ev = await insp.waitForPause();
    // FakeDap lists also the names without a value, which VS Code's JavaScript debugger leaves out.
    const entry = await collectSnapshot(new FakeDap(insp, ev), 1, 1);
    assert.deepEqual(variable(entry, 'Global scope', 'LIMIT'), { k: 'uninit' });
    assert.deepEqual(variable(entry, 'Global scope', 'Car'), { k: 'uninit' });

    // Step Into until JavaScript sets up the static variable of Car: the class itself is not initialized yet.
    let step = 1;
    let inStatic: MemorySnapshot | undefined;
    while (!inStatic && step < 20) {
      const next = await insp.step('stepInto');
      assert.ok(next, `the program still runs after step ${step}`);
      ev = next;
      const s = await collectSnapshot(new FakeDap(insp, ev), 1, ++step);
      if (s.frames.some((f) => f.name === 'Car (set up static variables)')) inStatic = s;
    }
    assert.ok(inStatic, 'a step pauses in the set-up of the static variables');
    assert.deepEqual(variable(inStatic, 'Global scope', 'LIMIT'), { k: 'num', v: '3' });
    const self = inStatic.objects[idOf(variable(inStatic, 'Car (set up static variables)', 'this'))];
    assert.equal(self.kind, 'class');
    // Deno 2.5 and newer give the internal empty value for Car here. Deno 2.0 to 2.4 read the class itself.
    const global = variable(inStatic, 'Global scope', 'Car');
    if (global.k !== 'uninit') assert.equal(idOf(global), self.id);

    ev = await insp.resumeToNextPause();
    const atEnd = await collectSnapshot(new FakeDap(insp, ev), 1, step + 1);
    const car = atEnd.objects[idOf(variable(atEnd, 'Global scope', 'Car'))];
    assert.equal(car.id, self.id);
    assert.deepEqual(car.fields?.find((f) => f.name === 'count')?.value, { k: 'num', v: '1' });
  } finally {
    await insp.close();
  }
});
