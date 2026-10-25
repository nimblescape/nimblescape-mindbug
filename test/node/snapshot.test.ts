// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// End-to-end test of the snapshot collector against a real Node.js program, through the V8 inspector of Node.js.
// Node.js runs the program with the TypeScript compiler of VS Code (typeScript.ts), the compiler that the command ts
// takes in VS Code. FakeDap answers the Debug Adapter Protocol request stackTrace the way VS Code's JavaScript debugger
// does, and the collector sends its requests to V8 directly, as through the CDP proxy of the debugger. The fixtures are ES modules (fixtures/package.json), as in a course.
//
// npm run test:node (vitest.node.config.mts); `npm test` does not run them. Without the TypeScript of the VS Code in
// .vscode-test/, Node.js 26 cannot run the fixtures, and the tests are skipped.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from '../../src/snapshot.ts';
import type { MemorySnapshot, Value, Variable } from '../../src/model.ts';
import { DEFAULT_LIMITS } from '../../src/heapWalker.ts';
import { FakeDap, inspectorV8, RoundCounter } from './fakeDap.ts';
import { NodeInspector } from './inspector.ts';
import { runsAllOfTypeScript } from './typeScript.ts';

const skip = !runsAllOfTypeScript();
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let port = 9400;

interface Pause {
  snapshot: MemorySnapshot;
  /** The number of rounds of requests, to the debugger and to V8. */
  rounds: number;
  /** The requests to the debugger. */
  dapRequests: string[];
}

/**
 * Runs a fixture and returns a snapshot at each `debugger;` statement, with the requests that it needed. `steps` gives
 * the number of the step of each pause (1, 2, 3, … by default).
 */
async function pausesWithRounds(
  name: string,
  count: number,
  options: { steps?: number[]; limits?: typeof DEFAULT_LIMITS } = {},
): Promise<Pause[]> {
  const insp = await NodeInspector.start(join(fixtures, name), port++);
  const out: Pause[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const ev = await insp.resumeToNextPause();
      const dap = new FakeDap(insp, ev);
      const counter = new RoundCounter(dap, inspectorV8(insp, ev));
      const snapshot = await collectSnapshot(counter.dap, counter.v8, 1, options.steps?.[i] ?? i + 1, {
        limits: options.limits,
      });
      out.push({ snapshot, rounds: counter.rounds, dapRequests: dap.log.map((r) => r.command) });
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

test.skipIf(skip)('insertion sort: frames, aliasing and stable ids', async () => {
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

test.skipIf(skip)('the variables of each scope are in the order of the program, not of their names', async () => {
  // VS Code's JavaScript debugger sorts the variables of a scope by name; V8 gives them in the order of the program.
  const [s] = await pauses('order.ts', 1);
  const names = (frame: string) => s.frames.find((f) => f.name === frame)?.vars.map((v) => v.name);
  assert.deepEqual(names('Global scope'), ['Car', 'bmw', 'toyota', 'a', 'b', 'swap', 'zeta', 'alpha']);
  assert.deepEqual(names('swap'), ['values', 'second', 'first', 'kept']);
});

test.skipIf(skip)('var and let: before their lines, and in blocks', async () => {
  const [start, inShop, inBlock] = await pauses('hoisting.ts', 3);
  const vars = (s: MemorySnapshot, frame: string) =>
    s.frames.find((f) => f.name === frame)?.vars.map((v) => [v.name, v.scope, v.block, v.value.k === 'ref' ? 'ref' : v.value]);
  const undef = { k: 'undef' };
  const uninit = { k: 'uninit' };
  // A function declaration has its value from the start.
  assert.deepEqual(vars(start, 'Global scope'), [
    ['label', 'module', undefined, undef],
    ['total', 'module', undefined, uninit],
    ['shop', 'module', undefined, 'ref'],
  ]);
  assert.deepEqual(vars(inShop, 'shop'), [
    ['prices', 'local', undefined, 'ref'],
    ['sum', 'local', undefined, uninit],
    ['note', 'local', undefined, undef],
  ]);
  // The var in the block is a variable of the function; the const of the loop and of its body are block variables.
  assert.deepEqual(vars(inBlock, 'shop'), [
    ['prices', 'local', undefined, 'ref'],
    ['sum', 'local', undefined, { k: 'num', v: '13' }],
    ['note', 'local', undefined, { k: 'str', v: 'expensive' }],
    ['price', 'block', 1, { k: 'num', v: '5' }],
    ['withShipping', 'block', 2, { k: 'num', v: '7' }],
  ]);
  // The if block declares only a var, so it has no scope.
  assert.deepEqual(inBlock.frames.find((f) => f.name === 'shop')?.blocks, ['for', 'for body']);
});

test.skipIf(skip)('each block scope is named after its statement', async () => {
  const steps = await pauses('statements.ts', 6);
  assert.deepEqual(
    steps.map((s) => s.frames.find((f) => f.name === 'Global scope')?.blocks),
    [['if'], ['for', 'for body'], ['while'], ['catch', 'catch body'], ['block', 'switch'], ['block']],
  );
  // A block around a function is no block of the function: its variables are closure variables of the function.
  const inner = steps[5].frames.find((f) => f.name === 'inner')!;
  assert.deepEqual(inner.blocks, ['if']);
  assert.deepEqual(
    inner.vars.map((v) => [v.name, v.scope, v.block]),
    [
      ['inside', 'block', 1],
      ['outside', 'closure', undefined],
    ],
  );
});

test.skipIf(skip)('a variable of a block with the name of a variable of the Global scope: both are shown', async () => {
  const [s] = await pauses('shadowing.ts', 1);
  const global = s.frames.find((f) => f.name === 'Global scope')!;
  // An object is shown by the value of its only field.
  const shown = (v: Variable) => [
    v.name,
    v.scope,
    v.block,
    v.value.k === 'ref' ? s.objects[v.value.id]?.fields?.[0]?.value : v.value,
  ];
  assert.deepEqual(global.vars.map(shown), [
    ['a', 'module', undefined, { k: 'num', v: '10' }],
    ['car', 'module', undefined, { k: 'str', v: 'VW' }],
    ['a', 'block', 1, { k: 'num', v: '200' }],
    ['car', 'block', 1, { k: 'str', v: 'BMW' }],
  ]);
  assert.deepEqual(global.blocks, ['block']);
});

test.skipIf(skip)('objects: getters are not called, closures, uninitialized let', async () => {
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

test.skipIf(skip)('classes: class boxes with static variables, attributes, methods and superclass', async () => {
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
  assert.equal(birthday.blocks, undefined, 'the scope of the class around the method is no block of the method');
});

test.skipIf(skip)('names: the variables t, e, r, n, i and o, in three rounds of requests for three scopes', async () => {
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
  // The stack trace with the call frames of V8, the variables of the three frames (the first step also installs the
  // heap walker), and the heap walker in the three frames. Only the stack trace is a request to the debugger.
  assert.equal(inLoop.rounds, 3);
  assert.equal(atEnd.rounds, 3);
  assert.deepEqual(inLoop.dapRequests, ['stackTrace']);
  assert.deepEqual(atEnd.dapRequests, ['stackTrace']);
  assert.equal(inLoop.snapshot.fallback, false);
});

test.skipIf(skip)('a new program in the same session: the heap walker is installed when it is missing', async () => {
  // A step after the first one, as after a restart of the program in the same debug session.
  const [first] = await pausesWithRounds('names.ts', 1, { steps: [5] });
  assert.deepEqual(variable(first.snapshot, 'inner', 'i'), { k: 'num', v: '1' });
  assert.equal(first.snapshot.fallback, false);
  // Three rounds, then the install, then the heap walker again.
  assert.equal(first.rounds, 5);
});

test.skipIf(skip)('a long result of the heap walker comes whole from V8', async () => {
  const [s] = await pausesWithRounds('long.ts', 1, { limits: { ...DEFAULT_LIMITS, str: 2000 } });
  const words = s.snapshot.objects[idOf(variable(s.snapshot, 'Global scope', 'words'))];
  assert.equal(words.items?.length, 100);
  words.items!.forEach((item, i) => assert.deepEqual(item, { k: 'str', v: `${i}:` + 'ä😀'.repeat(400) }));
  // VS Code's JavaScript debugger gives at most 100,000 characters of a string; V8 gives the whole text.
  assert.equal(s.rounds, 3);
});

test.skipIf(skip)('exported names before their lines have run are uninitialized, and the program goes on', async () => {
  // Reading such a name with `typeof` stopped Deno 2.5 ("abort: Unexpected instance type encountered"), which Mindbug 0.1 ran.
  const insp = await NodeInspector.start(join(fixtures, 'exports.ts'), port++, true);
  try {
    let ev = await insp.waitForPause();
    // V8 lists also the names without a value, which VS Code's JavaScript debugger leaves out.
    const entry = await collectSnapshot(new FakeDap(insp, ev), inspectorV8(insp, ev), 1, 1);
    assert.deepEqual(variable(entry, 'Global scope', 'LIMIT'), { k: 'uninit' });
    assert.deepEqual(variable(entry, 'Global scope', 'Car'), { k: 'uninit' });

    // Step Into until JavaScript sets up the static variable of Car: the class itself is not initialized yet.
    let step = 1;
    let inStatic: MemorySnapshot | undefined;
    while (!inStatic && step < 20) {
      const next = await insp.step('stepInto');
      assert.ok(next, `the program still runs after step ${step}`);
      ev = next;
      const s = await collectSnapshot(new FakeDap(insp, ev), inspectorV8(insp, ev), 1, ++step);
      if (s.frames.some((f) => f.name === 'Car (set up static variables)')) inStatic = s;
    }
    assert.ok(inStatic, 'a step pauses in the set-up of the static variables');
    assert.deepEqual(variable(inStatic, 'Global scope', 'LIMIT'), { k: 'num', v: '3' });
    const self = inStatic.objects[idOf(variable(inStatic, 'Car (set up static variables)', 'this'))];
    assert.equal(self.kind, 'class');
    // V8 can give the internal empty value for Car here (Deno 2.5 did), or the class itself (Node.js).
    const global = variable(inStatic, 'Global scope', 'Car');
    if (global.k !== 'uninit') assert.equal(idOf(global), self.id);

    ev = await insp.resumeToNextPause();
    const atEnd = await collectSnapshot(new FakeDap(insp, ev), inspectorV8(insp, ev), 1, step + 1);
    const car = atEnd.objects[idOf(variable(atEnd, 'Global scope', 'Car'))];
    assert.equal(car.id, self.id);
    assert.deepEqual(car.fields?.find((f) => f.name === 'count')?.value, { k: 'num', v: '1' });
  } finally {
    await insp.close();
  }
});
