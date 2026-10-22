// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Outer and inner functions.
//
// A function can be declared inside another function. receipt is the outer function, and addLine is the inner
// function: it is declared inside receipt, so only the code of receipt can call it. The inner function can use the
// variables of the outer function, because its code is written inside the outer function.
//
// Use Step Into (F11) on a call of addLine. Its scope is on top of the scope of receipt, and its box shows:
// - its own variables: the parameters name and price, and the local variable withTax;
// - below the line "from the enclosing scope", the variables of receipt that addLine uses: taxRate and lines.
//   Only the variables that the inner function uses are there: shop and total are not.
// taxRate and lines in the box of addLine are the same variables as in the box of receipt, not copies: lines in both
// boxes points to the same array on the heap, and when addLine adds a line to the array, both boxes show the change.
//
// Each call of addLine has its own scope: the second call gets a new name, price and withTax.

function receipt(shop: string): string[] {
  const taxRate = 0.25;
  const lines: string[] = [];
  let total = 0;

  function addLine(name: string, price: number): number {
    const withTax = price * (1 + taxRate);
    lines.push(`${name}: ${withTax}`);
    return withTax;
  }

  total = total + addLine('bread', 2);
  total = total + addLine('milk', 4);
  lines.push(`${shop}, total: ${total}`);
  return lines;
}

const myReceipt = receipt('Corner shop');
console.log(myReceipt.join('\n'));
