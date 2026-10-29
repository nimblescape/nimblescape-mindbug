// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { fromWebview, stepMarkText } from '../../src/model.ts';

test('names the shown step and the newest step at the line of an earlier step', () => {
  assert.equal(stepMarkText(8, 14), 'Mindbug: step 8 of 14');
  assert.equal(stepMarkText(1, 2), 'Mindbug: step 1 of 2');
});

test('names only the shown step when the newest step is not known', () => {
  assert.equal(stepMarkText(8, undefined), 'Mindbug: step 8');
  assert.equal(stepMarkText(8, 0), 'Mindbug: step 8');
});

test('the messages of the view: only the known messages, with numbers for steps and frames and no file', () => {
  assert.deepEqual(fromWebview({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(fromWebview({ type: 'viewStep', step: 3, live: false, file: '/etc/passwd', line: 1 }), {
    type: 'viewStep',
    step: 3,
    live: false,
  });
  assert.deepEqual(fromWebview({ type: 'openLocation', step: 3, frame: 0 }), { type: 'openLocation', step: 3, frame: 0 });
  assert.deepEqual(fromWebview({ type: 'viewOption', name: 'showIds', value: false }), {
    type: 'viewOption',
    name: 'showIds',
    value: false,
  });
  for (const bad of [
    undefined,
    null,
    'ready',
    { type: 'openLocation', file: '/etc/passwd', line: 1 },
    { type: 'openLocation', step: 3, frame: -1 },
    { type: 'openLocation', step: 1.5, frame: 0 },
    { type: 'viewStep', step: '3', live: true },
    { type: 'viewStep', step: 3 },
    { type: 'viewOption', name: 'maxObjects', value: true },
    { type: 'viewOption', name: 'showIds', value: 'false' },
    { type: 'runCommand', command: 'workbench.action.terminal.new' },
  ]) {
    assert.equal(fromWebview(bad), undefined, JSON.stringify(bad));
  }
});
