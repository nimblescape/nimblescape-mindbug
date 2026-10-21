// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The statement of a block scope, which the view names the scope after: "if scope", "for scope", and so on. V8 does
// not give the statement, but it gives the position where each block scope starts in the code that the runtime runs
// (Debugger.Scope.startLocation): the `{` of the block, the declaration in the header of a for loop (after `for (`),
// the `(` of a catch clause, or the word `switch`. The words before that position name the statement.
// This file does not import 'vscode'.

import type { BlockKind } from './model.ts';

/** The text of a script, with the offset of each line, for the positions of V8 (line and column from 0). */
export class ScriptText {
  readonly text: string;
  private readonly starts: number[] = [0];

  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }

  /** The offset of a position in the text, or undefined for a position outside it. */
  offset(line: number, column = 0): number | undefined {
    const start = this.starts[line];
    if (start === undefined) return undefined;
    const offset = start + column;
    return offset <= this.text.length ? offset : undefined;
  }
}

/** How far back the search for the `(` of a statement goes, so that a long text costs no time. */
const MAX_BACK = 2000;

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\w$]/.test(c);

/** The end of the text before `index` without the spaces at its end. */
function skipSpaceBack(text: string, index: number): number {
  while (index > 0 && isSpace(text[index - 1])) index--;
  return index;
}

/** The word that ends before `index` (spaces between are skipped), and where it starts. */
function wordBefore(text: string, index: number): { word: string; start: number } {
  const end = skipSpaceBack(text, index);
  let start = end;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  return { word: text.slice(start, end), start };
}

/** The `(` that belongs to the `)` at `close`, or undefined. */
function openParen(text: string, close: number): number | undefined {
  let depth = 0;
  for (let i = close; i >= 0 && close - i < MAX_BACK; i--) {
    if (text[i] === ')') depth++;
    else if (text[i] === '(' && --depth === 0) return i;
  }
  return undefined;
}

/** True when `for` or `for await` comes before the `(` at `open`. */
function isFor(text: string, open: number): boolean {
  const w = wordBefore(text, open);
  return w.word === 'for' || (w.word === 'await' && wordBefore(text, w.start).word === 'for');
}

/**
 * The statement of the block scope that starts at `offset` of `text`. `type` is the type of the scope in V8 ("block"
 * or "catch").
 */
export function blockKind(text: string, offset: number, type: string): BlockKind {
  if (type === 'catch') return 'catch';
  // The scope of the cases of a switch starts at the word switch.
  if (text.startsWith('switch', offset) && !isWordChar(text[offset + 6])) return 'switch';
  const end = skipSpaceBack(text, offset);
  if (text[offset] !== '{') {
    // The header of a for loop: its scope starts at the declaration, after `for (` or `for await (`.
    return text[end - 1] === '(' && isFor(text, end - 1) ? 'for' : 'block';
  }
  if (text[end - 1] === ')') {
    const open = openParen(text, end - 1);
    if (open === undefined) return 'block';
    const { word } = wordBefore(text, open);
    if (word === 'if' || word === 'while') return word;
    if (word === 'catch') return 'catch body';
    return isFor(text, open) ? 'for body' : 'block';
  }
  const { word } = wordBefore(text, end);
  // Not a word (for example the `:` of a label or of a case): a plain block.
  if (word === 'else' || word === 'do' || word === 'try' || word === 'catch' || word === 'finally') return word;
  return 'block';
}
