// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Three scopes, and variables with the names t, e, r, n, i and o, which VS Code's JavaScript debugger uses inside the
// function that it builds for an evaluate with the context "clipboard".

function outer(t: string): string {
  const e = t + '!';
  return inner(e);
}

function inner(o: string): string {
  for (let i = 0; i < 2; i++) {
    const r = i * 10;
    const n = { o, r };
    if (i === 1) debugger;
  }
  return o;
}

outer('tea');
debugger;
