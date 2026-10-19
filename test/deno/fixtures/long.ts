// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// An array whose snapshot text is longer than the 100,000 characters that VS Code's JavaScript debugger gives back:
// strings of characters outside ASCII, some with two UTF-16 code units (surrogate pairs).

const words = Array.from({ length: 100 }, (_, i) => `${i}:` + 'ä😀'.repeat(400));
debugger;
console.log(words.length);
