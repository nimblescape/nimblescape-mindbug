// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The variables of each scope come in an order that is not the order of their names.

class Car {
  brand: string;
  constructor(brand: string) {
    this.brand = brand;
  }
}

let bmw: Car; // a variable on the stack
bmw = new Car('BMW');
let toyota: Car = new Car('Toyota');
let a = 10;
let b = 20;

function swap(values: number[], second: number, first: number): void {
  const kept = values[first];
  values[first] = values[second];
  values[second] = kept;
  debugger;
}

{
  let zeta = a + b;
  let alpha = zeta;
  swap([a, b], 1, 0);
  console.log(alpha);
}
console.log(bmw, toyota);
