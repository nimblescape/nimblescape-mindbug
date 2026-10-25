// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Minimal source map reader for the tests: maps a line in the JavaScript that Node.js runs back to
// the line in the TypeScript file. VS Code's JavaScript debugger does the same with the source
// maps of the hooks of typeScriptHooks.ts, so the test stand-in (fakeDap.ts) reports the same line numbers.

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

/** For each generated line: the segments [generatedColumn, originalLine] (0-based), sorted by column. */
export type LineMap = [number, number][][];

export function parseMappings(mappings: string): LineMap {
  const lines: LineMap = [];
  let srcLine = 0;
  for (const lineText of mappings.split(';')) {
    const segs: [number, number][] = [];
    let col = 0;
    for (const seg of lineText.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      col += v[0];
      if (v.length >= 4) {
        srcLine += v[2];
        segs.push([col, srcLine]);
      }
    }
    lines.push(segs);
  }
  return lines;
}

/** Reads the map from a `data:` URL (the hooks of typeScriptHooks.ts inline their source maps). */
export function lineMapFromUrl(url: string): LineMap | undefined {
  const m = /^data:application\/json[^,]*?(;base64)?,(.*)$/s.exec(url);
  if (!m) return undefined;
  const text = m[1] ? Buffer.from(m[2], 'base64').toString('utf8') : decodeURIComponent(m[2]);
  const map = JSON.parse(text) as { mappings?: string };
  return map.mappings ? parseMappings(map.mappings) : undefined;
}

/** Original 0-based line for a generated position, or undefined when the map has no entry. */
export function originalLine(map: LineMap, line: number, column: number): number | undefined {
  const segs = map[line];
  if (!segs || segs.length === 0) return undefined;
  let best = segs[0];
  for (const s of segs) {
    if (s[0] <= column) best = s;
    else break;
  }
  return best[1];
}
