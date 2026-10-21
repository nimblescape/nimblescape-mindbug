// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A variable of a block can have the name of a variable of the scope around the block. In the block, the name means
// the variable of the block; the variable of the scope keeps its value.

let a = 10;
let car = { brand: 'VW' };
{
  let a = 200;
  let car = { brand: 'BMW' };
  debugger; // two variables a and two variables car: the ones of the Global scope and the ones of the block
  console.log(a, car);
}
console.log(a, car);
