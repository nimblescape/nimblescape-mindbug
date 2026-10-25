// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { debugConfiguration } from '../../src/runtime.ts';

test('the debug configuration: the debug type "ts" runs the program', () => {
  const c = debugConfiguration('/w/a.ts', '/w', true);
  assert.deepEqual(c, { name: 'Mindbug: a.ts', type: 'ts', request: 'launch', program: '/w/a.ts', cwd: '/w', stopOnEntry: true });
  assert.equal(debugConfiguration('/w/a.ts', '/w', false).stopOnEntry, false);
});

test('the other attributes of the launch configuration pass through to the debug type "ts"', () => {
  const c = debugConfiguration('/w/a.ts', '/w', true, { args: ['x'], console: 'internalConsole', name: 'Mine' });
  assert.deepEqual(c.args, ['x']);
  assert.equal(c.console, 'internalConsole');
  assert.equal(c.name, 'Mine');
  // The attributes of Mindbug win.
  const own = debugConfiguration('/w/a.ts', '/w', false, { type: 'node', request: 'attach', program: '/x.ts', stopOnEntry: true });
  assert.deepEqual([own.type, own.request, own.program, own.stopOnEntry], ['ts', 'launch', '/w/a.ts', false]);
});
