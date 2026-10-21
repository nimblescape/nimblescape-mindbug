// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Blocks { … } and their variables, and two variables with the same name.
// Use Step Into (F11) on each line and look at the STACK.
//
// 1. The Global scope has a and b.
// 2. The block declares a second variable a. In the block, the name
//    a means this variable of the block, so c is 200 + 20. The a of
//    the Global scope still exists and keeps its value 10: the view
//    shows both, each one in its own part.
// 3. The for loop has two blocks: the loop header with i, and the
//    body with d. The body part is inside the header part. The if
//    block inside the body adds a third part with e.
// 4. The while loop has no variable in its header, so only its body
//    is a block. n is a variable of the outer block.
// 5. When a block ends, its part and its variables go away. At the
//    last line, only the a and b of the Global scope are left.

let a = 10;
let b = 20;
{
  let a = 200;
  let c = a + b;
  for (let i = 0; i < 2; i++) {
    const d = c + i;
    if (d > c) {
      const e = d * 2;
      console.log(a, e);
    }
  }
  let n = 0;
  while (n < 2) {
    const square = n * n;
    n = n + 1;
    console.log(square);
  }
}
console.log(a, b);
