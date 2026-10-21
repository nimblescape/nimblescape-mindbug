// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A `var` is a variable of its function from the start of the call, with the value undefined, also when its line is
// in a block. A `let` or `const` is a variable of its block, and is uninitialized until its line has run.

console.log('start');
debugger; // shop is already a function, label (var) is undefined, total (let) is uninitialized
var label = 'Shop';
let total = shop([4, 5, 6]);
console.log(label, total);

function shop(prices: number[]): number {
  debugger; // note (var) is undefined, sum (let) is uninitialized
  let sum = 0;
  for (const price of prices) {
    const withShipping = price + 2;
    sum = sum + withShipping;
    if (sum > 10) {
      var note = 'expensive';
      debugger; // note is a variable of shop; price and withShipping are variables of the blocks
    }
  }
  return sum;
}
