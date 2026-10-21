// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Where the block scopes of a frame are in the TypeScript file, for their marks in the editor. V8 gives the block
// scopes of the paused frame with their statements (Frame.blocks), but its positions are positions in the code that
// the runtime runs, which for Deno is JavaScript that Deno made from the TypeScript file. The debugger gives the paused
// position in the TypeScript file. So this file finds the brackets of the TypeScript file around that position, and
// matches them from the inside out with the block scopes of V8: a block without a scope (it declares no `let`,
// `const` or `class`) is skipped, and the body of the function ends the search.
// This file does not import 'vscode'.

import { skipSpaceBack, wordBefore } from './blockKind.ts';
import type { BlockKind } from './model.ts';

/** A pair of brackets in the code: the offsets of the opening and of the closing bracket. */
export interface BracketPair {
  char: '(' | '[' | '{';
  open: number;
  close: number;
}

/** Words after which a `/` starts a regular expression, not a division. */
const BEFORE_EXPRESSION = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);

const isWordChar = (c: string | undefined) => c !== undefined && /[\w$]/.test(c);

/** The end of a string literal that starts at `i` (its quote). */
function stringEnd(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === quote || text[j] === '\n') return j + 1;
  }
  return text.length;
}

/** The end of a regular expression literal that starts at `i` (its `/`). */
function regexEnd(text: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') j++;
    else if (c === '\n') return j;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return j + 1;
  }
  return text.length;
}

/** Reads the text of a template literal from `i` on: up to its end, or up to a `${`. */
function templatePart(text: string, i: number): { end: number; expression: boolean } {
  for (let j = i; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '`') return { end: j + 1, expression: false };
    else if (text[j] === '$' && text[j + 1] === '{') return { end: j + 2, expression: true };
  }
  return { end: text.length, expression: false };
}

/** The pairs of brackets of the code, without the brackets in comments, strings, templates and regular expressions. */
export function bracketPairs(text: string): BracketPair[] {
  const pairs: BracketPair[] = [];
  // `$` is the `${` of a template literal, whose `}` goes back into the template.
  const open: { char: '(' | '[' | '{' | '$'; at: number }[] = [];
  let expressionNext = true;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      i = stringEnd(text, i);
      expressionNext = false;
    } else if (c === '`') {
      const part = templatePart(text, i + 1);
      if (part.expression) open.push({ char: '$', at: part.end - 1 });
      i = part.end;
      expressionNext = part.expression;
    } else if (c === '/' && expressionNext) {
      i = regexEnd(text, i);
      expressionNext = false;
    } else if (isWordChar(c)) {
      let j = i;
      while (j < text.length && isWordChar(text[j])) j++;
      expressionNext = BEFORE_EXPRESSION.has(text.slice(i, j));
      i = j;
    } else if (c === '(' || c === '[' || c === '{') {
      open.push({ char: c, at: i });
      expressionNext = true;
      i++;
    } else if (c === ')' || c === ']' || c === '}') {
      const top = open.pop();
      if (top?.char === '$' && c === '}') {
        const part = templatePart(text, i + 1);
        if (part.expression) open.push({ char: '$', at: part.end - 1 });
        i = part.end;
        expressionNext = part.expression;
        continue;
      }
      if (top && top.char !== '$' && top.char === { ')': '(', ']': '[', '}': '{' }[c]) {
        pairs.push({ char: top.char, open: top.at, close: i });
      }
      // A `}` ends a block, after which an expression can start; a `)` or `]` ends an expression.
      expressionNext = c === '}';
      i++;
    } else {
      if (!/\s/.test(c)) expressionNext = true;
      i++;
    }
  }
  return pairs;
}

/** What a pair of brackets around the paused position is. */
type Owner = BlockKind | 'for header' | 'catch header' | 'function' | 'class' | 'other';

/** What the `{` at `open` belongs to. `parens` gives the `(` of each `)`. */
function braceOwner(text: string, open: number, parens: Map<number, number>): Owner {
  const end = skipSpaceBack(text, open);
  const prev = text[end - 1];
  if (prev === ')') {
    const paren = parens.get(end - 1);
    if (paren === undefined) return 'other';
    const { word, start } = wordBefore(text, paren);
    if (word === 'if' || word === 'while' || word === 'switch') return word;
    if (word === 'catch') return 'catch body';
    if (word === 'for' || (word === 'await' && wordBefore(text, start).word === 'for')) return 'for body';
    // A function, a method, a getter or a setter.
    return 'function';
  }
  if (prev === '>' && text[end - 2] === '=') return 'function';
  if (isWordChar(prev)) {
    const { word } = wordBefore(text, end);
    if (word === 'else' || word === 'do' || word === 'try' || word === 'finally' || word === 'catch') return word;
    if (word === 'static') return 'function';
    // `return {` and the like start an object; a name before `{` is a class (`class Car {`, `extends Base {`).
    return BEFORE_EXPRESSION.has(word) ? 'other' : 'class';
  }
  // After a statement, at the start, or after a label or a case: a plain block.
  if (end === 0 || prev === ';' || prev === '{' || prev === '}') return 'block';
  if (prev === ':') {
    const { word, start } = wordBefore(text, end - 1);
    const before = text[skipSpaceBack(text, start) - 1];
    if (word === 'default' || wordBefore(text, start).word === 'case') return 'block';
    if (word && (before === undefined || before === ';' || before === '{' || before === '}')) return 'block';
  }
  // An object, or a type.
  return 'other';
}

/** A block scope of the paused frame in the code: the brackets of its block, or of the header of its statement. */
export interface BlockRange {
  /** The number of the block, from the outermost block of the frame (1). */
  block: number;
  kind: BlockKind;
  /** The offsets of the opening and the closing bracket: `{ }` of the block, or `( )` of the header of a for loop or of a catch clause. */
  open: number;
  close: number;
  /** True for the `( )` of a header. */
  header: boolean;
}

/**
 * The block scopes of the frame that is paused at `offset` of `text`, from the outermost one. `blocks` are the
 * statements of its block scopes in V8, from the outermost one. Undefined when the brackets of the code do not match
 * the block scopes of V8, for example when the file changed after the program started.
 */
export function blockRanges(
  text: string,
  offset: number,
  blocks: readonly BlockKind[],
  pairs: BracketPair[] = bracketPairs(text),
): BlockRange[] | undefined {
  if (blocks.length === 0) return [];
  const parens = new Map(pairs.filter((p) => p.char === '(').map((p) => [p.close, p.open]));
  // The brackets around the paused position, from the innermost one.
  const around = pairs
    .filter((p) => p.char !== '[' && p.open < offset && offset < p.close)
    .sort((a, b) => b.open - a.open)
    .map((p) => ({ ...p, owner: ownerOf(text, p, parens) }));
  // The ( ) of the header of a loop body or a catch body.
  const headerOf = (body: { open: number }) => {
    const close = skipSpaceBack(text, body.open) - 1;
    const open = parens.get(close);
    return open === undefined ? undefined : { open, close };
  };

  const wanted = [...blocks].reverse();
  const found: Omit<BlockRange, 'block'>[] = [];
  const take = (kind: BlockKind, open: number, close: number, header: boolean) => {
    found.push({ kind, open, close, header });
  };
  for (const p of around) {
    const kind = wanted[found.length];
    if (kind === undefined || p.owner === 'function' || p.owner === 'class') break;
    if (kind === 'for' && p.owner === 'for header') take('for', p.open, p.close, true);
    else if (kind === 'catch' && p.owner === 'catch header') take('catch', p.open, p.close, true);
    else if (p.char === '{' && kind === p.owner) take(kind, p.open, p.close, false);
    else if (p.char === '{' && ((kind === 'for' && p.owner === 'for body') || (kind === 'catch' && p.owner === 'catch body'))) {
      // The body has no scope of its own, but the header has.
      const h = headerOf(p);
      if (h) take(kind, h.open, h.close, true);
      continue;
    } else continue;
    // The header of a loop body or a catch body with a scope of its own.
    const next = wanted[found.length];
    if (p.char === '{' && ((next === 'for' && p.owner === 'for body') || (next === 'catch' && p.owner === 'catch body'))) {
      const h = headerOf(p);
      if (h) take(next, h.open, h.close, true);
    }
  }
  if (found.length !== wanted.length) return undefined;
  return found.reverse().map((r, i) => ({ ...r, block: i + 1 }));
}

function ownerOf(text: string, p: BracketPair, parens: Map<number, number>): Owner {
  if (p.char === '{') return braceOwner(text, p.open, parens);
  const { word, start } = wordBefore(text, p.open);
  if (word === 'for' || (word === 'await' && wordBefore(text, start).word === 'for')) return 'for header';
  if (word === 'catch') return 'catch header';
  return 'other';
}

/** How the editor marks a block scope. Lines and columns count from 0. */
export interface BlockMark {
  block: number;
  kind: BlockKind;
  /**
   * A bar at `column`, the indent of the line where the block starts, on the lines inside a block of several lines.
   * Only lines that reach the column get the bar, so an empty line has none.
   */
  bar?: { column: number; lines: number[] };
  /** A frame around the text from offset `start` to offset `end`: a header `( )`, or a block on one or two lines. */
  frame?: { start: number; end: number };
}

/** The marks of the block scopes in the editor. */
export function blockMarks(text: string, ranges: readonly BlockRange[]): BlockMark[] {
  const lines = text.split('\n');
  const lineOf = (offset: number) => {
    let line = 0;
    for (let at = 0; line < lines.length - 1 && at + lines[line].length < offset; line++) at += lines[line].length + 1;
    return line;
  };
  return ranges.map((r) => {
    const first = lineOf(r.open);
    const last = lineOf(r.close);
    if (r.header || last - first < 2) return { block: r.block, kind: r.kind, frame: { start: r.open, end: r.close + 1 } };
    const column = lines[first].length - lines[first].trimStart().length;
    const inside: number[] = [];
    for (let l = first + 1; l < last; l++) if (lines[l].length > column) inside.push(l);
    return { block: r.block, kind: r.kind, bar: { column, lines: inside } };
  });
}
