// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Finds the declaration of each variable of a scope in the source text of the program, so that the view can show the
// variables in the order of the program. V8 gives the variables of a scope in that order, but VS Code's JavaScript
// debugger sorts them by name. This file reads the text with a small scanner, not with a parser of TypeScript: it
// finds the names in the code (not in comments, strings or property names after a dot), the braces around each name,
// and the names that a declaration introduces. A wrong guess changes only the order of the variables in the view.

/** A name in the code. */
interface Occurrence {
  offset: number;
  /** The number of open braces around the name, without the braces of an import or export list or a destructuring. */
  depth: number;
  /** True when a declaration introduces the name: after `let`, `const`, `var`, `function` or `class`, or in an import. */
  declares: boolean;
}

/** The names of a source text, with the place of each of their occurrences. */
export interface SourceIndex {
  readonly length: number;
  /** The offset of the start of each line. */
  readonly lineStarts: number[];
  readonly names: Map<string, Occurrence[]>;
}

const DECLARING = new Set(['let', 'const', 'var', 'function', 'class', 'enum']);
/** The words after which a `/` starts a regular expression and is not a division. */
const BEFORE_EXPRESSION = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
/** The words of an import that are not names of the program. */
const IMPORT_WORDS = new Set(['import', 'from', 'as', 'type', 'typeof', 'default']);

const IDENTIFIER = /[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*/uy;
const NUMBER = /\.?\d[\w.]*/y;
const SPACE = /\s/;
const LINE_BREAK = /\r\n|[\n\r\u2028\u2029]/g;

/**
 * The kinds of the open brackets on the stack of the scanner: "brace" for the `{` of a block, a function body, a class
 * body or an object, "list" for the `{` of an import or export list or of a destructuring after `let`, `const` or
 * `var`, "template" for `${` in a template literal, and "bracket" for `(` and `[`.
 */
type Open = 'brace' | 'list' | 'template' | 'bracket';

/** The offset after the match of the sticky expression `re` at `i`, or -1. */
function matchEnd(re: RegExp, text: string, i: number): number {
  re.lastIndex = i;
  return re.test(text) ? re.lastIndex : -1;
}

const cache = new Map<string, SourceIndex>();
const CACHE_SIZE = 8;

/** The index of a source text. The last indexes stay in a cache, so the text of a file is read once per change. */
export function indexSource(text: string): SourceIndex {
  const hit = cache.get(text);
  if (hit) return hit;
  const index = scan(text);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(text, index);
  return index;
}

function scan(text: string): SourceIndex {
  const lineStarts = [0];
  for (const m of text.matchAll(LINE_BREAK)) lineStarts.push(m.index + m[0].length);
  const names = new Map<string, Occurrence[]>();

  const stack: Open[] = [];
  let depth = 0;
  /** The previous token: a word, a punctuator, or "" for a value (a number, a string, a regular expression). */
  let prev = '';
  let prevIsWord = false;
  let beforePrev = '';
  let inImport = false;
  /** The stack height of the `let`, `const` or `var` whose declarations a `,` continues, or -1. */
  let declarationList = -1;
  let afterDeclarationComma = false;
  let lastImported: Occurrence | undefined;

  const token = (t: string, isWord: boolean) => {
    beforePrev = prev;
    prev = t;
    prevIsWord = isWord;
  };
  const close = () => {
    const open = stack.pop();
    if (open === 'brace') depth--;
    if (stack.length < declarationList) declarationList = -1;
    return open;
  };
  /** Scans a template literal from `i` (after "`" or after the `}` of "${...}") and returns the offset after it. */
  const template = (i: number): number => {
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') i += 2;
      else if (c === '`') return i + 1;
      else if (c === '$' && text[i + 1] === '{') {
        stack.push('template');
        return i + 2;
      } else i++;
    }
    return i;
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (SPACE.test(c)) {
      i++;
    } else if (c === '/' && next === '/') {
      while (i < text.length && !/[\n\r\u2028\u2029]/.test(text[i])) i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i++;
      token('', false);
      if (inImport && stack.length === 0) inImport = false;
    } else if (c === '`') {
      i = template(i + 1);
      token('', false);
    } else if (c === '/' && (prevIsWord ? BEFORE_EXPRESSION.has(prev) : prev !== '' && prev !== ')' && prev !== ']')) {
      // A regular expression
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j++;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        j++;
      }
      if (text[j] === '/') {
        i = Math.max(j + 1, matchEnd(IDENTIFIER, text, j + 1));
        token('', false);
      } else {
        i++;
        token('/', false);
      }
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(next ?? ''))) {
      i = Math.max(i + 1, matchEnd(NUMBER, text, i));
      token('', false);
    } else if (c === '#' || matchEnd(IDENTIFIER, text, i) > i) {
      // A private name (#count) is never a variable.
      const end = Math.max(i + 1, matchEnd(IDENTIFIER, text, c === '#' ? i + 1 : i));
      const word = text.slice(i, end);
      const property = c === '#' || (!prevIsWord && (prev === '.' || prev === '?.'));
      if (!property) {
        if (word === 'import' && !/^\s*[(.]/.test(text.slice(end, end + 20))) inImport = true;
        if (inImport && word === 'as' && lastImported) lastImported.declares = false;
        const declares =
          (prevIsWord && DECLARING.has(prev)) ||
          (prev === '*' && beforePrev === 'function') ||
          afterDeclarationComma ||
          (inImport && !IMPORT_WORDS.has(word));
        const occurrence: Occurrence = { offset: i, depth, declares };
        const list = names.get(word);
        if (list) list.push(occurrence);
        else names.set(word, [occurrence]);
        lastImported = inImport && declares ? occurrence : undefined;
        if (inImport && word === 'from' && prev !== '{' && prev !== ',' && prev !== 'as') inImport = false;
        if (!inImport && (word === 'let' || word === 'const' || word === 'var')) declarationList = stack.length;
      }
      afterDeclarationComma = false;
      i = end;
      token(property ? '' : word, !property);
    } else {
      const three = text.slice(i, i + 3);
      const two = text.slice(i, i + 2);
      const punctuator = three === '...' ? three : two === '?.' && !/\d/.test(text[i + 2] ?? '') ? two : c;
      i += punctuator.length;
      const listBrace =
        inImport || afterDeclarationComma || (prevIsWord && ['let', 'const', 'var', 'export'].includes(prev));
      afterDeclarationComma = false;
      if (punctuator === '{') {
        stack.push(listBrace ? 'list' : 'brace');
        if (!listBrace) depth++;
      } else if (punctuator === '(' || punctuator === '[') {
        stack.push('bracket');
      } else if (punctuator === '}' || punctuator === ')' || punctuator === ']') {
        if (stack.length > 0 && close() === 'template') {
          i = template(i);
          token('', false);
          continue;
        }
      } else if (punctuator === ',') {
        afterDeclarationComma = declarationList === stack.length;
      } else if (punctuator === ';') {
        if (stack.length <= declarationList) declarationList = -1;
        if (stack.length === 0) inImport = false;
      }
      token(punctuator, false);
    }
  }
  return { length: text.length, lineStarts, names };
}

/** The offset of a position in the text; `line` and `column` count from 1, as the debugger gives them. */
export function offsetOf(index: SourceIndex, line: number, column: number): number {
  const start = index.lineStarts[Math.max(0, line - 1)];
  if (start === undefined) return index.length;
  return Math.min(index.length, start + Math.max(0, column - 1));
}

/**
 * The offset of the declaration of each name in the part of the text from `start` to `end`, or Infinity when the
 * name is not in that part. Of the occurrences of a name, the one with the fewest braces around it is the
 * declaration of the variable of the scope; the other ones are in an inner block or function. Of those, an
 * occurrence that declares the name wins, else the first one: a parameter, or a name of a destructuring.
 */
export function declarationOffsets(index: SourceIndex, names: string[], start: number, end: number): number[] {
  return names.map((name) => {
    let best: Occurrence | undefined;
    for (const o of index.names.get(name) ?? []) {
      if (o.offset < start || o.offset >= end) continue;
      if (!best || o.depth < best.depth || (o.depth === best.depth && o.declares && !best.declares)) best = o;
    }
    return best ? best.offset : Infinity;
  });
}
