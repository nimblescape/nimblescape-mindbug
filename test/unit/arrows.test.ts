// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { arrowPath, classLinkPath, generalizationPath } from '../../webview/arrows.ts';

const end = (d: string) => d.trim().split(/[ ,]+/).slice(-2).map(Number);

test('an arrow to an object on the right ends at its left edge', () => {
  const d = arrowPath({ x: 100, y: 50, right: 140 }, { left: 300, right: 400, y: 80 });
  assert.match(d, /^M 100\.0 50\.0 C /);
  assert.deepEqual(end(d), [299, 80]);
});

test('an arrow to an object on the left or below ends at its right edge', () => {
  const d = arrowPath({ x: 450, y: 400, right: 540 }, { left: 340, right: 540, y: 180 });
  assert.deepEqual(end(d), [541, 180]);
  assert.match(d, /C 590\.0 400\.0, 590\.0 180\.0/);
});

test('extends: to the right edge of a superclass on the left, or to the bottom of one above', () => {
  const sameRow = generalizationPath({ left: 640, top: 250, right: 850, bottom: 470 }, { left: 350, top: 250, right: 560, bottom: 500 });
  assert.deepEqual(end(sameRow), [561, 300]);
  const above = generalizationPath({ left: 350, top: 600, right: 560, bottom: 700 }, { left: 350, top: 250, right: 560, bottom: 500 });
  assert.deepEqual(end(above), [455, 501]);
});

test('dashed class link goes to the bottom of a class above the object', () => {
  const d = classLinkPath({ left: 350, top: 690, right: 560, bottom: 800 }, { left: 640, top: 250, right: 850, bottom: 460 });
  assert.match(d, /^M 561\.0 706\.0 /);
  assert.deepEqual(end(d), [745, 462]);
});
