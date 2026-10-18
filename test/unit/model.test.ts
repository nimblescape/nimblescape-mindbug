// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { stepMarkText } from '../../src/model.ts';

test('names the shown step and the newest step at the line of an earlier step', () => {
  assert.equal(stepMarkText(8, 14), 'Mindbug: step 8 of 14');
  assert.equal(stepMarkText(1, 2), 'Mindbug: step 1 of 2');
});

test('names only the shown step when the newest step is not known', () => {
  assert.equal(stepMarkText(8, undefined), 'Mindbug: step 8');
  assert.equal(stepMarkText(8, 0), 'Mindbug: step 8');
});
