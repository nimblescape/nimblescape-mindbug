// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Block scopes of different statements. The view names each one after its statement.

let n = 1;
if (n > 0) {
  const yes = 1;
  debugger; // if
} else {
  const no = 2;
}
for (let i = 0; i < 1; i++) {
  const d = i;
  debugger; // for, for body
}
while (n < 2) {
  const inWhile = n;
  n++;
  debugger; // while
}
try {
  throw new Error('x');
} catch (err) {
  const inCatch = 1;
  debugger; // catch, catch body
}
{
  const plain = 1;
  switch (n) {
    case 2:
      const inSwitch = 1;
      debugger; // block, switch
  }
}
{
  const outside = 1;
  const inner = () => {
    if (outside > 0) {
      const inside = 2;
      debugger; // if in inner; the block around inner is no block of inner
      return inside;
    }
    return 0;
  };
  inner();
}
console.log(n);
