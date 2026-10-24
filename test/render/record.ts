// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Records the memory snapshots of the example programs, step by step, with a real Node.js, as Mindbug runs it
// (test/node/typeScript.ts: with the TypeScript compiler of the VS Code that `npm run test:vscode` downloads). The
// screenshot test (screenshots.ts) draws these snapshots, so it does not need Node.js to run the examples.
//
//   npm run record
//
// Writes test/render/snapshots/<example>.json: an array with one snapshot for each step.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot } from '../../src/snapshot.ts';
import type { MemorySnapshot } from '../../src/model.ts';
import { FakeDap, inspectorV8 } from '../node/fakeDap.ts';
import { NodeInspector } from '../node/inspector.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const MAX_STEPS = 120;

/** Steps through the program like a student who presses "Step Into" again and again. */
export async function record(file: string, port: number): Promise<MemorySnapshot[]> {
  const insp = await NodeInspector.start(file, port, true);
  const steps: MemorySnapshot[] = [];
  try {
    let ev = await insp.waitForPause();
    while (ev && steps.length < MAX_STEPS) {
      const top = ev.callFrames[0];
      if (!top.url.endsWith(file.split(/[\\/]/).pop()!)) {
        // Inside the code of Node.js (for example console.log): leave it.
        const next = await insp.step('stepOut');
        if (!next) break;
        ev = next;
        continue;
      }
      // The last line usually calls console.log; stop there.
      const snap = await collectSnapshot(new FakeDap(insp, ev), inspectorV8(insp, ev), 1, steps.length + 1);
      steps.push(snap);
      const next = await insp.step('stepInto');
      if (!next) break;
      ev = next;
    }
  } finally {
    await insp.close();
  }
  return steps;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = join(here, 'snapshots');
  mkdirSync(out, { recursive: true });
  let port = 9340;
  for (const name of ['insertion-sort', 'people', 'linked-list', 'call-stack', 'blocks']) {
    const file = join(root, 'examples', `${name}.ts`);
    const steps = await record(file, port++);
    // Paths differ from machine to machine; keep only the part below the repository.
    // One step per line, so a diff shows which steps changed.
    const text = `[\n${steps.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`.split(root).join('/workspace');
    writeFileSync(join(out, `${name}.json`), text);
    console.log(`${name}: ${steps.length} steps`);
  }
}
