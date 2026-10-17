import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StepHistory, baseName, stepLineText, stepTitle, whereText } from '../../webview/history.ts';
import type { MemorySnapshot } from '../../src/model.ts';

function snap(step: number, line = step, name = 'f'): MemorySnapshot {
  return {
    step,
    frames: [
      { frameId: 0, name: 'Global frame', isGlobal: true, line: 1, file: '/w/a.ts', vars: [] },
      { frameId: 1, name, isGlobal: false, line, file: '/w/sort.ts', vars: [] },
    ],
    objects: {},
    missing: [],
  };
}

test('follows the newest step while it shows the newest step', () => {
  const h = new StepHistory();
  assert.ok(h.isLive());
  h.add(snap(1), 's');
  h.add(snap(2), 's');
  assert.equal(h.current()?.step, 2);
  assert.equal(h.previous()?.step, 1);
  assert.ok(h.isLive());
});

test('stays on an earlier step when a new step arrives', () => {
  const h = new StepHistory();
  for (let i = 1; i <= 3; i++) h.add(snap(i), 's');
  assert.ok(h.show(0));
  assert.ok(!h.isLive());
  h.add(snap(4), 's');
  assert.equal(h.current()?.step, 1);
  assert.equal(h.newest()?.step, 4);
  assert.equal(h.previous(), undefined);
  h.show(99);
  assert.equal(h.current()?.step, 4);
  assert.ok(h.isLive());
  assert.ok(!h.show(99), 'no change');
});

test('a new session starts a new history', () => {
  const h = new StepHistory();
  h.add(snap(1), 'a');
  h.add(snap(2), 'a');
  h.add(snap(1), 'b');
  assert.equal(h.length, 1);
  assert.equal(h.sessionId, 'b');
});

test('keeps at most maxSteps steps and keeps the shown step when the oldest is removed', () => {
  const h = new StepHistory(3);
  for (let i = 1; i <= 3; i++) h.add(snap(i), 's');
  h.show(1); // step 2
  h.add(snap(4), 's');
  assert.deepEqual(
    h.snapshots.map((s) => s.step),
    [2, 3, 4],
  );
  assert.equal(h.current()?.step, 2);
});

test('replace shows the newest step', () => {
  const h = new StepHistory(2);
  h.replace([snap(1), snap(2), snap(3)], 'x');
  assert.deepEqual(
    h.snapshots.map((s) => s.step),
    [2, 3],
  );
  assert.ok(h.isLive());
});

test('texts for the status line and the step list', () => {
  assert.equal(whereText(snap(4, 12)), 'sort.ts, line 12');
  assert.equal(stepLineText(snap(4, 12)), 'line 12');
  assert.equal(stepTitle(snap(4, 12, 'insertionSort')), 'Step 4: function insertionSort, line 12');
  assert.equal(baseName('C:\\work\\a.ts'), 'a.ts');
  assert.equal(whereText({ step: 1, frames: [], objects: {}, missing: [], location: 'x.js:3' }), 'x.js:3');
});
