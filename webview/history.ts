// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// The step history of one debug session: every pause adds a snapshot.
// The panel can show any earlier step; it follows the newest step only while it shows the newest step.
// No DOM code here, so the unit tests can use it directly.

import type { Frame, MemorySnapshot } from '../src/model.ts';

export const DEFAULT_MAX_STEPS = 500;

export class StepHistory {
  snapshots: MemorySnapshot[] = [];
  /** Index in `snapshots` of the step that is shown; -1 when there are no steps. */
  view = -1;
  sessionId = '';
  readonly maxSteps: number;

  constructor(maxSteps = DEFAULT_MAX_STEPS) {
    this.maxSteps = Math.max(1, maxSteps);
  }

  get length(): number {
    return this.snapshots.length;
  }

  /** True when the newest step is shown (or there are no steps). */
  isLive(): boolean {
    return this.view === this.snapshots.length - 1;
  }

  current(): MemorySnapshot | undefined {
    return this.snapshots[this.view];
  }

  /** The step before the shown step. Changes are computed against it. */
  previous(): MemorySnapshot | undefined {
    return this.view > 0 ? this.snapshots[this.view - 1] : undefined;
  }

  newest(): MemorySnapshot | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /** Adds a new pause. A new session id starts a new history. */
  add(snap: MemorySnapshot, sessionId: string): void {
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      this.snapshots = [];
      this.view = -1;
    }
    const wasLive = this.isLive();
    this.snapshots.push(snap);
    if (this.snapshots.length > this.maxSteps) {
      this.snapshots.shift();
      if (!wasLive) this.view = Math.max(0, this.view - 1);
    }
    if (wasLive) this.view = this.snapshots.length - 1;
  }

  /** Replaces the whole history, for example when the panel opens during a session. */
  replace(snaps: MemorySnapshot[], sessionId: string): void {
    this.sessionId = sessionId;
    this.snapshots = snaps.slice(-this.maxSteps);
    this.view = this.snapshots.length - 1;
  }

  /** Shows the step at `index` (clamped to the valid range). Returns true when the view changed. */
  show(index: number): boolean {
    if (this.snapshots.length === 0) return false;
    const next = Math.max(0, Math.min(this.snapshots.length - 1, index));
    const changed = next !== this.view;
    this.view = next;
    return changed;
  }
}

/** The frame that runs at this step: the newest call. */
export function topFrame(snap: MemorySnapshot): Frame | undefined {
  return snap.frames[snap.frames.length - 1];
}

export function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i >= 0 ? path.slice(i + 1) : path;
}

/** "insertion-sort.ts, line 7", or the short location from the debugger when there is no user frame. */
export function whereText(snap: MemorySnapshot): string | undefined {
  const top = topFrame(snap);
  if (top?.file) return `${baseName(top.file)}, line ${top.line}`;
  return snap.location;
}

/** Short text for the step list, for example "line 12". */
export function stepLineText(snap: MemorySnapshot): string {
  const top = topFrame(snap);
  return top ? `line ${top.line}` : '–';
}

/** Tooltip for one step in the step list. */
export function stepTitle(snap: MemorySnapshot): string {
  const top = topFrame(snap);
  if (!top) return `Step ${snap.step}`;
  const fn = top.isGlobal ? 'top level of the program' : `function ${top.name}`;
  return `Step ${snap.step}: ${fn}, line ${top.line}`;
}
