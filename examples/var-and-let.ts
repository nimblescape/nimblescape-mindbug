// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Since when a variable exists, and in which scope it lives.
// Use Step Into (F11) on each line and look at the STACK.
//
// 1. At the first line, the Global scope already has all its
//    variables: shop is a function, label (var) is undefined,
//    and total (let) is uninitialized. A let cannot be read
//    before its line has run.
// 2. In the call of shop, sum (let) is uninitialized, and
//    note (var) is undefined, although the line of note is
//    inside a block.
// 3. In the loop, price and withShipping are variables of the
//    blocks of the loop. They go away when the loop ends.
// 4. note is a variable of the whole function: it is still
//    there after its block, at the return.

var label = 'Shop';
let total = shop([4, 5, 6]);
console.log(label, total);

function shop(prices: number[]): number {
  let sum = 0;
  for (const price of prices) {
    const withShipping = price + 2;
    sum = sum + withShipping;
    if (sum > 10) {
      var note = 'expensive';
    }
  }
  return sum;
}
