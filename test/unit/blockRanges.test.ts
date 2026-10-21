// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Where the block scopes of the paused frame are in the TypeScript file, for their marks in the editor.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockMarks, blockRanges, bracketPairs } from '../../src/blockRanges.ts';
import type { BlockKind } from '../../src/model.ts';

const BLOCKS = readFileSync(join(import.meta.dirname, '../../examples/blocks.ts'), 'utf8');

/** The offset of line `line` (from 1) and column `column` (from 1), as the debugger gives the paused position. */
function offsetAt(text: string, line: number, column: number): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let l = 0; l < line - 1; l++) offset += lines[l].length + 1;
  return offset + column - 1;
}

/** The text of each block range, with its kind. */
function ranges(text: string, line: number, column: number, blocks: BlockKind[]) {
  return blockRanges(text, offsetAt(text, line, column), blocks)?.map((r) => [r.block, r.kind, text.slice(r.open, r.close + 1).split('\n')[0]]);
}

test('brackets in strings, comments, templates and regular expressions do not count', () => {
  const text = "const s = '(' + \"{\"; // )\n/* } */ const t = `a ${f({ x: 1 })} }`; const r = /[)}]/g; if (a) { b(); }";
  assert.deepEqual(
    bracketPairs(text).map((p) => text.slice(p.open, p.close + 1)),
    ['{ x: 1 }', '({ x: 1 })', '(a)', '()', '{ b(); }'],
  );
});

test('the block scopes of the example blocks.ts at the line of console.log(a, e)', () => {
  assert.deepEqual(ranges(BLOCKS, 30, 7, ['block', 'for', 'for body', 'if']), [
    [1, 'block', '{'],
    [2, 'for', '(let i = 0; i < 2; i++)'],
    [3, 'for body', '{'],
    [4, 'if', '{'],
  ]);
});

test('a block without a scope is skipped, and the header of a loop whose body has no scope is found', () => {
  // At `const d = c + i;` V8 has the for body; at the `if`, it has no scope for the if block (paused before it).
  assert.deepEqual(ranges(BLOCKS, 27, 5, ['block', 'for', 'for body']), [
    [1, 'block', '{'],
    [2, 'for', '(let i = 0; i < 2; i++)'],
    [3, 'for body', '{'],
  ]);
  // In the header of the loop (`i < 2`), only the scope of the header exists.
  assert.deepEqual(ranges(BLOCKS, 26, 19, ['block', 'for']), [
    [1, 'block', '{'],
    [2, 'for', '(let i = 0; i < 2; i++)'],
  ]);
  const text = 'function shop(prices) {\n  for (const price of prices) {\n    if (price > 4) {\n      note = 3;\n    }\n  }\n}\n';
  assert.deepEqual(ranges(text, 4, 7, ['for']), [[1, 'for', '(const price of prices)']]);
});

test('other statements, and the body of the function ends the search', () => {
  const text = [
    'function f(n: number) {',
    '  while (n < 2) {',
    '    const w = n;',
    '    try {',
    '      throw new Error("x");',
    '    } catch (err) {',
    '      const c = { a: 1 };',
    '      switch (n) {',
    '        case 1: {',
    '          const k = 1;',
    '          console.log(k);',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ].join('\n');
  assert.deepEqual(ranges(text, 11, 11, ['while', 'catch', 'catch body', 'switch', 'block']), [
    [1, 'while', '{'],
    [2, 'catch', '(err)'],
    [3, 'catch body', '{'],
    [4, 'switch', '{'],
    [5, 'block', '{'],
  ]);
  // A block scope that the code does not have: no marks at all.
  assert.equal(ranges(text, 11, 11, ['if', 'while', 'catch', 'catch body', 'switch', 'block']), undefined);
});

test('the marks: a bar at the indent of the line of the block, or a frame', () => {
  const offset = offsetAt(BLOCKS, 30, 7);
  const marks = blockMarks(BLOCKS, blockRanges(BLOCKS, offset, ['block', 'for', 'for body', 'if'])!);
  const lineOf = (n: number) => n - 1;
  assert.deepEqual(
    marks.map((m) => [m.kind, m.bar?.column, m.bar?.lines[0], m.bar?.lines.at(-1), m.frame && BLOCKS.slice(m.frame.start, m.frame.end)]),
    [
      ['block', 0, lineOf(24), lineOf(38), undefined],
      ['for', undefined, undefined, undefined, '(let i = 0; i < 2; i++)'],
      ['for body', 2, lineOf(27), lineOf(31), undefined],
      ['if', 4, lineOf(29), lineOf(30), undefined],
    ],
  );
  // A block on one line gets a frame.
  const one = 'let n = 1;\n{ let plain = 1; f(plain); }\n';
  const [m] = blockMarks(one, blockRanges(one, offsetAt(one, 2, 18), ['block'])!);
  assert.equal(one.slice(m.frame!.start, m.frame!.end), '{ let plain = 1; f(plain); }');
});
