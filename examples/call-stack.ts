// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Function calls, and how long the objects that a function creates live.
//
// The call stack: the Global scope calls checkout, checkout calls makeBill, and makeBill calls lineTotal. So, when
// the program is in lineTotal, four scopes are on the stack. Use Step Into (F11) to see each call add a scope on
// top, and Step Out (Shift+F11) to see its scope go away. Each scope has its own local variables: bill in makeBill,
// bill in checkout and bill in the Global scope are three different variables. A constructor is a function too:
// Step Into on `new` adds the scope of the constructor on top.
//
// The objects are instances of the classes Item, Discount and Bill. The view shows the classes at the top of the
// heap. Objects that a function creates:
// - lineTotal (the inner function) creates a Discount object, and only its local variable discount points to it.
//   The object does not survive the call: when lineTotal returns, nothing points to the object any more, so the view
//   does not show it any more. JavaScript frees its memory later (garbage collection). The next call of lineTotal
//   creates a new Discount object.
// - makeBill (the middle function) creates a Bill object. The object survives the calls of lineTotal, because the
//   variable bill of makeBill still points to it. It also survives the call of makeBill: makeBill returns it,
//   checkout returns it too, and at the end the variable bill of the Global scope points to it.

class Item {
  name: string;
  price: number;
  count: number;

  constructor(name: string, price: number, count: number) {
    this.name = name;
    this.price = price;
    this.count = count;
  }
}

class Discount {
  minCount: number;
  percent: number;

  constructor(minCount: number, percent: number) {
    this.minCount = minCount;
    this.percent = percent;
  }
}

class Bill {
  customer: string;
  total = 0;
  paid = false;

  constructor(customer: string) {
    this.customer = customer;
  }
}

function lineTotal(item: Item): number {
  const discount = new Discount(3, 10);
  let total = item.price * item.count;
  if (item.count >= discount.minCount) {
    total = total - (total * discount.percent) / 100;
  }
  return total;
}

function makeBill(customer: string, items: Item[]): Bill {
  const bill = new Bill(customer);
  for (const item of items) {
    bill.total += lineTotal(item);
  }
  return bill;
}

function checkout(customer: string, items: Item[]): Bill {
  const bill = makeBill(customer, items);
  bill.paid = true;
  return bill;
}

const cart: Item[] = [new Item('apples', 2, 3), new Item('bread', 4, 1)];
const bill = checkout('Ann', cart);
console.log(bill);
