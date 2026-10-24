// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

class Person {
  static count = 0;
  static species = 'human';
  static registry: Person[] = [];
  name: string;
  age: number;

  constructor(name: string, age: number) {
    this.name = name;
    this.age = age;
    Person.count++;
    Person.registry.push(this);
  }

  birthday(): void {
    this.age++;
    debugger;
  }

  get label(): string {
    return `${this.name} (${this.age})`;
  }

  static reset(): void {
    Person.count = 0;
  }
}

class Student extends Person {
  constructor(name: string, age: number, public school: string) {
    super(name, age);
  }
}

class Config {
  static debug = true;
}

const ann = new Person('Ann', 24);
const bob = new Student('Bob', 19, 'HTL Wien');
ann.birthday();
console.log(ann, bob, Config.debug);
