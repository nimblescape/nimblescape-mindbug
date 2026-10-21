// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { declarationOffsets, indexSource, offsetOf } from '../../src/sourceOrder.ts';
import { inSourceOrder, type DapScope } from '../../src/snapshot.ts';

/** The names in the order of their declarations in `text`, from `start` to `end`; a name without one comes last. */
function order(text: string, names: string[], start = 0, end = text.length): string[] {
  const at = declarationOffsets(indexSource(text), names, start, end);
  return names
    .map((name, i) => ({ name, at: at[i] }))
    .sort((a, b) => (a.at === b.at ? 0 : a.at - b.at))
    .map((x) => x.name);
}

const sortedByName = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b));

test('the variables of the Global scope in the order of the program', () => {
  // The program of the report: the debugger gave a, b, bmw, toyota.
  const text = `import { log } from "node:console";
import { Car } from "./cars.ts";

let bmw: Car; // a variable on the stack
bmw = new Car("BMW", "iX3", 270, 60, 7);
let toyota: Car;
toyota = new Car("Toyota", "Yaris", 70, 30, 3);
bmw = toyota;
// global scope
let a = 10;
let b = 20;
{
  let c = 100;
  log(a, b, c);
}
`;
  assert.deepEqual(order(text, sortedByName(['log', 'Car', 'bmw', 'toyota', 'a', 'b'])), [
    'log',
    'Car',
    'bmw',
    'toyota',
    'a',
    'b',
  ]);
});

test('a declaration wins over an earlier use in a function, and over a name in a comment, a string or a property', () => {
  const text = `
function show(): void {
  console.log(count, total);
}
// count and total are declared here:
let label = "count";
let total = 1, more = { count: 2, total: 3 }, last;
const re = /[/]count/g;
let text = \`\${total} of \${ { count: 1 }.count }\`;
let count = more.count + more.total;
class Car {
  #count = 0;
  label(a: number): number { return a / 2; }
}
`;
  assert.deepEqual(
    order(text, sortedByName(['show', 'count', 'total', 'label', 'more', 'last', 're', 'text', 'Car'])),
    ['show', 'label', 'total', 'more', 'last', 're', 'text', 'count', 'Car'],
  );
});

test('imports, destructuring and names without a declaration', () => {
  const text = `import Default, { first as renamed, second } from "./m.ts";
import * as all from "./all.ts";
const { x, y: why } = all;
let [p, q] = [1, 2];
`;
  assert.deepEqual(
    order(text, ['q', 'why', 'all', 'second', 'renamed', 'Default', 'p', 'x', 'Return value', 'first']),
    ['Default', 'first', 'renamed', 'second', 'all', 'x', 'why', 'p', 'q', 'Return value'],
  );
});

test('the scope of a function: the parameters, then the variables of its body, not of an inner function', () => {
  const text = `let value = 0;
function swap(values: number[], second: number, first: number): void {
  const helper = (first: number) => first;
  const kept = values[first];
  for (let second = 0; second < 1; second++) {}
}
`;
  const index = indexSource(text);
  const start = text.indexOf('(values');
  const end = text.lastIndexOf('}') + 1;
  assert.equal(offsetOf(index, 2, start - text.indexOf('function') + 1), start);
  assert.deepEqual(order(text, ['kept', 'helper', 'first', 'second', 'values'], start, end), [
    'values',
    'second',
    'first',
    'helper',
    'kept',
  ]);
  // `value` is not in the part of the function.
  assert.deepEqual(declarationOffsets(index, ['value'], start, end), [Infinity]);
});

test('inSourceOrder: the scope of the debugger gives the part of the file', () => {
  const text = `let zeta = 1;
let alpha = 2;
{
  let omega = 3;
  let beta = 4;
}
`;
  const source = indexSource(text);
  const vars = (names: string[]) => names.map((name) => ({ name, value: '1', variablesReference: 0 }));
  const names = (scope: DapScope, kind: 'module' | 'block', file = '/s/order.ts') =>
    inSourceOrder(
      vars(sortedByName(kind === 'module' ? ['zeta', 'alpha'] : ['omega', 'beta'])),
      scope,
      kind,
      file,
      source,
    ).map((v) => v.name);
  const block = { name: 'Block', variablesReference: 2, line: 3, column: 1, endLine: 6, endColumn: 2 };
  // The Module scope is the whole file.
  assert.deepEqual(names({ name: 'Module', variablesReference: 1 }, 'module'), ['zeta', 'alpha']);
  assert.deepEqual(names({ ...block, source: { path: '/s/order.ts' } }, 'block'), ['omega', 'beta']);
  // In a remote window, the debugger names the file with a URI.
  assert.deepEqual(names({ ...block, source: { path: 'vscode-remote://codespaces+x/s/order.ts' } }, 'block'), [
    'omega',
    'beta',
  ]);
  // Without the source of the scope, or for a scope of another file, the order of the debugger stays.
  assert.deepEqual(names(block, 'block'), ['beta', 'omega']);
  assert.deepEqual(names({ ...block, source: { path: '/s/other.ts' } }, 'block'), ['beta', 'omega']);
});
