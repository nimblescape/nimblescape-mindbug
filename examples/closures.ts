// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Closures: an inner function that lives longer than the call of its outer function.
//
// makeCounter is the outer function. It declares the variable count and the inner function next, and returns next
// without calling it. The local variables of a function usually go away when the function returns. But next uses
// count and prefix, so these variables stay alive as long as next exists. A function together with the variables of
// the outer function that it uses is a closure.
//
// The program makes two counters, ticketsA and ticketsB. Each call of makeCounter creates a new count and a new
// prefix, so each counter has its own count.
//
// Use Step Into (F11) on a call of ticketsA() or ticketsB(). The scope of next is on top of the Global scope:
// makeCounter is not on the stack any more, because its call has ended. Still, the box of next shows prefix and
// count below the line "from the enclosing scope": the variables of the call of makeCounter that made this counter.
// At the start of the first call of ticketsA, count is 0, and the call changes it to 1. At the start of the second
// call of ticketsA, count is 1: the first call changed it, and the change stayed. At the start of the call of
// ticketsB, count is 0: it is the count of the other counter.
//
// Turn on the switch "Show functions" to see the variables ticketsA and ticketsB, and the two function objects on
// the heap that they point to.

function makeCounter(prefix: string): () => string {
  let count = 0;

  function next(): string {
    count = count + 1;
    return `${prefix}-${count}`;
  }

  return next;
}

const ticketsA = makeCounter('A');
const ticketsB = makeCounter('B');
const first = ticketsA();
const second = ticketsA();
const third = ticketsB();
console.log(first, second, third);
