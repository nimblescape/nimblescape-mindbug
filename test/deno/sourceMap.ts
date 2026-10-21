// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Minimal source map reader for the tests: maps a position in the JavaScript that Deno runs back to
// the position in the TypeScript file. VS Code's JavaScript debugger does the same with the source
// maps that Deno sends, so the test stand-in (fakeDap.ts) reports the same lines and columns.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlq(text: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of text) {
    const digit = BASE64.indexOf(ch);
    if (digit < 0) continue;
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** For each generated line: the segments [generatedColumn, originalLine, originalColumn] (0-based), sorted by column. */
export type LineMap = [number, number, number][][];

export function parseMappings(mappings: string): LineMap {
  const lines: LineMap = [];
  let srcLine = 0;
  let srcColumn = 0;
  for (const lineText of mappings.split(';')) {
    const segs: [number, number, number][] = [];
    let col = 0;
    for (const seg of lineText.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      col += v[0];
      if (v.length >= 4) {
        srcLine += v[2];
        srcColumn += v[3];
        segs.push([col, srcLine, srcColumn]);
      }
    }
    lines.push(segs);
  }
  return lines;
}

/** Reads the map from a `data:` URL (Deno inlines its source maps). */
export function lineMapFromUrl(url: string): LineMap | undefined {
  const m = /^data:application\/json[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return undefined;
  const text = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]);
  const map = JSON.parse(text) as { mappings?: string };
  return map.mappings ? parseMappings(map.mappings) : undefined;
}

/**
 * Original 0-based line and column for a generated position, or undefined when the map has no entry: the segment at
 * the position or the last one before it on its line, as VS Code's JavaScript debugger takes it.
 */
export function originalPosition(map: LineMap, line: number, column: number): { line: number; column: number } | undefined {
  const segs = map[line];
  if (!segs || segs.length === 0) return undefined;
  let best = segs[0];
  for (const s of segs) {
    if (s[0] <= column) best = s;
    else break;
  }
  return { line: best[1], column: best[2] + Math.max(0, column - best[0]) };
}

/** Original 0-based line for a generated position, or undefined when the map has no entry. */
export function originalLine(map: LineMap, line: number, column: number): number | undefined {
  return originalPosition(map, line, column)?.line;
}
