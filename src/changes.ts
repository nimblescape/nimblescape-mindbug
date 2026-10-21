// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Finds what changed between two snapshots, so the webview can highlight it.

import type { ChangeSet, HeapObject, MemorySnapshot, Value, Variable } from './model.ts';

export function sameValue(a: Value, b: Value): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Key of a variable: frames are matched by position from the bottom and by name, variables by their scope, their block
 * and their name. A variable of a block can have the name of a variable of the function; they are two variables.
 */
export function varKey(frameIndex: number, frameName: string, v: Pick<Variable, 'name' | 'scope' | 'block'>): string {
  return `${frameIndex}:${frameName}:${v.scope}${v.block ?? ''}:${v.name}`;
}

/** Key of one slot of a heap object. */
export function slotKey(objectId: number, slot: string): string {
  return `${objectId}:${slot}`;
}

/** Slot names: "3" for array index 3, ".name" for a field, "k:<key>" for a map key, "s:<value>" for a set member. */
export function objectSlots(o: HeapObject): Map<string, Value> {
  const m = new Map<string, Value>();
  if (o.kind === 'array') {
    o.items?.forEach((v, i) => m.set(String(i), v));
  } else if (o.kind === 'set') {
    for (const v of o.items ?? []) m.set(`s:${JSON.stringify(v)}`, v);
  }
  for (const f of o.fields ?? []) m.set(`.${f.name}`, f.value);
  for (const e of o.entries ?? []) m.set(`k:${JSON.stringify(e.key)}`, e.value);
  return m;
}

export function emptyChanges(): ChangeSet {
  return { vars: new Set(), slots: new Set(), newObjects: new Set() };
}

export function computeChanges(prev: MemorySnapshot | undefined, next: MemorySnapshot): ChangeSet {
  const out = emptyChanges();
  if (!prev) return out;

  const prevFrames = new Set<string>();
  const prevVars = new Map<string, Value>();
  prev.frames.forEach((f, i) => {
    prevFrames.add(`${i}:${f.name}`);
    for (const v of f.vars) prevVars.set(varKey(i, f.name, v), v.value);
  });
  next.frames.forEach((f, i) => {
    // A new call: all its variables are new, so nothing is marked.
    if (!prevFrames.has(`${i}:${f.name}`)) return;
    for (const v of f.vars) {
      const key = varKey(i, f.name, v);
      const old = prevVars.get(key);
      if (!old || !sameValue(old, v.value)) out.vars.add(key);
    }
  });

  for (const o of Object.values(next.objects)) {
    const p = prev.objects[o.id];
    if (!p) {
      if (!prev.missing.includes(o.id)) out.newObjects.add(o.id);
      continue;
    }
    const before = objectSlots(p);
    for (const [slot, value] of objectSlots(o)) {
      const old = before.get(slot);
      if (!old || !sameValue(old, value)) out.slots.add(slotKey(o.id, slot));
    }
  }
  return out;
}
