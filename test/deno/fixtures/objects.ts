class Address {
  constructor(public city: string, public zip: string) {}
}

class Person {
  private secretCount = 0;
  #hidden = 'private field';
  friends: Person[] = [];
  constructor(public name: string, public age: number, public home: Address) {}

  get secret(): number {
    this.secretCount++;
    return this.secretCount;
  }

  birthday(years: number): void {
    this.age += years;
    debugger;
  }
}

function makeCounter() {
  let count = 0;
  return () => {
    count++;
    debugger;
    return count;
  };
}

const home = new Address('Vienna', '1010');
const ann = new Person('Ann', 23, home);
const bob = new Person('Bob', 31, home);
ann.friends.push(bob);
bob.friends.push(ann);
const scores = new Map<string, number>([['ann', 3], ['bob', 5]]);
const tags = new Set(['a', 'b']);
const grid = [[1, 2], [3, 4]];
const sparse = [1, , 3];
const special = { negZero: -0, nan: NaN, big: 10n, sym: Symbol('s'), nothing: null, undef: undefined, long: 'x'.repeat(300) };
const when = new Date(Date.UTC(2026, 9, 16));
ann.birthday(1);
const counter = makeCounter();
counter();
debugger;
let later = 5;
console.log(later, scores, tags, grid, sparse, special, when);
