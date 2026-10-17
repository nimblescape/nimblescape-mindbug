// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Classes and objects. Each object is made from a class (its template).
// The static variable `count` belongs to the class: there is one value for all objects.

class Address {
  city: string;
  zip: string;

  constructor(city: string, zip: string) {
    this.city = city;
    this.zip = zip;
  }
}

class Person {
  static count = 0;
  name: string;
  age: number;
  home: Address;
  bestFriend: Person | null = null;

  constructor(name: string, age: number, home: Address) {
    this.name = name;
    this.age = age;
    this.home = home;
    Person.count++;
  }

  birthday(): void {
    this.age++;
  }
}

class Student extends Person {
  school: string;

  constructor(name: string, age: number, home: Address, school: string) {
    super(name, age, home);
    this.school = school;
  }
}

const home = new Address('Vienna', '1010');
const ann = new Person('Ann', 24, home);
const bob = new Student('Bob', 19, home, 'HTL Wien');
ann.bestFriend = bob;
ann.birthday();
console.log(Person.count);
