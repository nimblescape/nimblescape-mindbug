// Function calls, and how long the objects that a function creates live.
//
// The call stack: the Global scope calls checkout, checkout calls makeBill, and makeBill calls lineTotal. So, when
// the program is in lineTotal, four scopes are on the stack. Use Step Into (F11) to see each call add a scope on
// top, and Step Out (Shift+F11) to see its scope go away. Each scope has its own local variables: bill in makeBill,
// bill in checkout and bill in the Global scope are three different variables.
//
// Objects that a function creates:
// - lineTotal (the inner function) creates an object, and only its local variable discount points to it. The object
//   does not survive the call: when lineTotal returns, nothing points to the object any more, so the view does not
//   show it any more. JavaScript frees its memory later (garbage collection). The next call of lineTotal creates a
//   new object.
// - makeBill (the middle function) creates the object bill. The object survives the calls of lineTotal, because the
//   variable bill of makeBill still points to it. It also survives the call of makeBill: makeBill returns it,
//   checkout returns it too, and at the end the variable bill of the Global scope points to it.

interface Item {
  name: string;
  price: number;
  count: number;
}

interface Bill {
  customer: string;
  total: number;
  paid: boolean;
}

function lineTotal(item: Item): number {
  const discount = { minCount: 3, percent: 10 };
  let total = item.price * item.count;
  if (item.count >= discount.minCount) {
    total = total - (total * discount.percent) / 100;
  }
  return total;
}

function makeBill(customer: string, items: Item[]): Bill {
  const bill: Bill = { customer, total: 0, paid: false };
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

const cart: Item[] = [
  { name: 'apples', price: 2, count: 3 },
  { name: 'bread', price: 4, count: 1 },
];
const bill = checkout('Ann', cart);
console.log(bill);
