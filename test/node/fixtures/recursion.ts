// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A recursion: each call of fill has its own array of 20 cells, and all calls reach the same shared array.

interface Cell {
  n: number;
}

const shared: Cell[] = [];
for (let i = 0; i < 10; i++) shared.push({ n: i });

function fill(depth: number, all: Cell[]): void {
  const own: Cell[] = [];
  for (let i = 0; i < 20; i++) own.push({ n: depth * 100 + i });
  if (depth < 3) fill(depth + 1, all);
  else debugger;
}

fill(1, shared);
