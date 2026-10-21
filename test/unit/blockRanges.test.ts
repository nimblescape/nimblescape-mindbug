// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Where the block scopes of the paused frame are in the TypeScript file, for their marks in the editor.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blockMarkLines, blockMarks, blockRanges, bracketPairs } from '../../src/blockRanges.ts';
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

test('the marks: a rectangle around the lines between the braces, or around the whole for loop', () => {
  const offset = offsetAt(BLOCKS, 30, 7);
  const marks = blockMarks(BLOCKS, blockRanges(BLOCKS, offset, ['block', 'for', 'for body', 'if'])!);
  const lineOf = (n: number) => n - 1;
  // The right side is four columns after the longest line, `  for (let i = 0; i < 2; i++) {` (31 columns).
  assert.deepEqual(
    marks.map((m) => [m.kind, m.first, m.last, m.indent, m.right]),
    [
      ['block', lineOf(24), lineOf(38), 2, 35],
      ['for', lineOf(26), lineOf(32), 2, 35],
      ['for body', lineOf(27), lineOf(31), 4, 35],
      ['if', lineOf(29), lineOf(30), 6, 35],
    ],
  );
  // A block on one line holds its line.
  const one = 'let n = 1;\n{ let plain = 1; f(plain); }\n';
  assert.deepEqual(
    blockMarks(one, blockRanges(one, offsetAt(one, 2, 18), ['block'])!).map((m) => [m.first, m.last, m.indent, m.right]),
    [[1, 1, 0, 32]],
  );
  // The indent is the smallest indent of the lines that are not empty, and a tab counts up to the next tab stop.
  const tabs = 'if (x) {\n\tlet a = 1;\n\n  \t  f(a);\n}\n';
  assert.deepEqual(
    blockMarks(tabs, blockRanges(tabs, offsetAt(tabs, 2, 3), ['if'])!, bracketPairs(tabs), 4).map((m) => [m.first, m.last, m.indent]),
    [[1, 3, 4]],
  );
  // The rectangle of a catch header holds the whole catch clause.
  const caught = 'try {\n  f();\n} catch (err) {\n  g(err);\n}\n';
  assert.deepEqual(
    blockMarks(caught, blockRanges(caught, offsetAt(caught, 4, 3), ['catch'])!).map((m) => [m.kind, m.first, m.last, m.indent]),
    [['catch', 2, 4, 0]],
  );
});

test('the CSS of the rectangles: the sides on each line, the top on the first line, the bottom on the last line', () => {
  const offset = offsetAt(BLOCKS, 30, 7);
  const lines = blockMarkLines(blockMarks(BLOCKS, blockRanges(BLOCKS, offset, ['block', 'for', 'for body', 'if'])!));
  const css = (line: number, index = 0) => lines.filter((l) => l.line === line - 1)[index].css.split('; ');
  // 15 lines of the block, 7 of the for loop, 5 of its body, 2 of the if block.
  assert.equal(lines.length, 15 + 7 + 5 + 2);
  // The first line of the block: VS Code writes the CSS after `text-decoration:`, so it starts with its value.
  const top = css(24);
  assert.equal(top[0], 'none');
  assert.ok(top.includes('position: absolute'));
  assert.ok(top.includes('border: 0 solid var(--vscode-nimblescape-mindbug-blockScope1)'));
  assert.ok(top.includes('left: max(0px, calc(2ch - 6px + 0px))'));
  assert.ok(top.includes('width: calc(35ch - 0px - max(0px, calc(2ch - 6px + 0px)))'));
  assert.ok(top.includes('top: 1px') && top.includes('bottom: 0px') && top.includes('border-top-width: 2px'));
  assert.ok(!top.includes('border-bottom-width: 2px'));
  // A line in the middle has only the left and the right side.
  const middle = css(25);
  assert.ok(middle.includes('top: 0px') && middle.includes('bottom: 0px') && middle.includes('border-left-width: 2px'));
  assert.ok(!middle.some((p) => p.startsWith('border-top') || p.startsWith('border-bottom')));
  // The for loop starts at the same indent as the block: its left side is 3 pixels further in, and its right side
  // 5 pixels. It has the color of the second part.
  const loop = css(26, 1);
  assert.ok(loop.includes('border: 0 solid var(--vscode-nimblescape-mindbug-blockScope2)'));
  assert.ok(loop.includes('left: max(0px, calc(2ch - 6px + 3px))'));
  assert.ok(loop.includes('width: calc(35ch - 5px - max(0px, calc(2ch - 6px + 3px)))'));
  // The for body ends on the line before the end of the for loop, so it keeps no extra distance there; the if block
  // is the fourth part, inside three rectangles.
  assert.ok(css(31, 2).includes('bottom: 1px'));
  assert.ok(css(30, 3).includes('bottom: 1px'));
  assert.ok(css(29, 3).includes('width: calc(35ch - 15px - max(0px, calc(6ch - 6px + 0px)))'));
  // A fifth part has the color of the first one again.
  const deep = blockMarkLines([1, 2, 3, 4, 5].map((block) => ({ block, kind: 'block', first: block, last: 10 - block, indent: block * 2, right: 20 })));
  assert.ok(deep.at(-1)!.css.includes('var(--vscode-nimblescape-mindbug-blockScope1)'));
  // Rectangles that start on the same line keep 3 pixels away from each other at the top.
  const same = blockMarkLines([
    { block: 1, kind: 'for', first: 0, last: 4, indent: 0, right: 10 },
    { block: 2, kind: 'for body', first: 0, last: 3, indent: 0, right: 10 },
  ]);
  assert.ok(same.find((l) => l.line === 0 && l.css.includes('blockScope2'))!.css.includes('top: 4px'));
});
