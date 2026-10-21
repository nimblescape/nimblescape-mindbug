// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The statement of a block scope, from the code where V8 says that the scope starts. The positions are the ones that
// V8 gives (tested with Deno 2.9 and Node.js 22): the `{` of a block, a place in the header of a for loop, the `(` of
// a catch clause, and the word switch. Deno runs the code that it made from the TypeScript file (`for(`, `while(w < 1){`); Node.js runs the
// TypeScript file with the types replaced by spaces, so the spaces of the student stay.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { blockKind, ScriptText } from '../../src/blockKind.ts';

/** The statement of the scope that starts at the first `|` of `code` (the `|` is not part of the code). */
function kindAt(code: string, type = 'block') {
  const offset = code.indexOf('|');
  return blockKind(code.slice(0, offset) + code.slice(offset + 1), offset, type);
}

test('blocks of statements', () => {
  assert.equal(kindAt('let n = 1;\n|{ let plain = 1; }'), 'block');
  assert.equal(kindAt('}if (n > 0) |{ let yes = 1; }'), 'if');
  assert.equal(kindAt('if (n > 0) { } else |{ let no = 2; }'), 'else');
  assert.equal(kindAt('} else if (n > 0) |{ let elseIf = 3; }'), 'if');
  assert.equal(kindAt('while(w < 1)|{ const inWhile = w; }'), 'while');
  assert.equal(kindAt('do |{ const inDo = 1; } while (false);'), 'do');
  assert.equal(kindAt('|switch(n){ case 1: const inSwitch = 1; }'), 'switch');
  assert.equal(kindAt('switch(n){\n  case 1:\n    |{ const inCase = 1; }'), 'block');
  assert.equal(kindAt('try |{ const inTry = 1; }'), 'try');
  assert.equal(kindAt('try { } finally|{ const inFinally = 2; }'), 'finally');
  assert.equal(kindAt('outer: |{ const labeled = 1; }'), 'block');
  assert.equal(kindAt('class K {\n  static|{ const inStatic = 1; }'), 'block');
});

test('the header and the body of a for loop', () => {
  assert.equal(kindAt('for(|let i = 0; i < 2; i++){ const d = i; }'), 'for');
  assert.equal(kindAt('for(let i = 0; i < 2; i++)|{ const d = i; }'), 'for body');
  assert.equal(kindAt('for (|const x of [1]) { }'), 'for');
  assert.equal(kindAt('for (const x of [f(1), (2)])|{ const body = x; }'), 'for body');
  assert.equal(kindAt('for(|const k in { a: 1 }){ }'), 'for');
  assert.equal(kindAt('for await (|const line of lines) { }'), 'for');
  assert.equal(kindAt('for await (const line of lines) |{ const n = 1; }'), 'for body');
  // V8 of Node.js 22 starts the scope of the header at the `(` of a for loop, and at the `)` of a for … of loop.
  assert.equal(kindAt('for|(let i = 0; i < 2; i++){ const d = i; }'), 'for');
  assert.equal(kindAt('for (const x of [1]|){ const body = x; }'), 'for');
  assert.equal(kindAt('for (const k in { a: 1 }|){ }'), 'for');
  // A parenthesis that is not the header of a for loop.
  assert.equal(kindAt('const f = (|x) => x;'), 'block');
  assert.equal(kindAt('f(|x);'), 'block');
  assert.equal(kindAt('f(x|);'), 'block');
});

test('catch clauses', () => {
  assert.equal(kindAt('} catch |(err) { const inCatch = 1; }', 'catch'), 'catch');
  assert.equal(kindAt('} catch (err) |{ const inCatch = 1; }'), 'catch body');
  assert.equal(kindAt('} catch  |{ const inCatch2 = 1; }'), 'catch');
});

test('the text and the positions of a script', () => {
  const script = new ScriptText('let a = 1;\n{\n  let b = 2;\n}\n');
  assert.equal(script.offset(0, 0), 0);
  assert.equal(script.text[script.offset(1, 0)!], '{');
  assert.equal(script.text.slice(script.offset(2, 2)), 'let b = 2;\n}\n');
  assert.equal(script.offset(9, 0), undefined);
  assert.equal(script.offset(0, 99), undefined);
});
