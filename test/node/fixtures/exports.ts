// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Exported names before their lines have run. V8 gives the debugger an internal empty value for them, not a
// ReferenceError as for a name that is not exported. While Car sets up its static variable, the debugger lists Car
// in the Global scope.
export const LIMIT = 3;

export class Car {
  static count = 0;
  brand: string;

  constructor(brand: string) {
    Car.count++;
    this.brand = brand;
  }
}

const car = new Car('VW');
debugger;
console.log(car, LIMIT);
