// Places heap objects in rows, in the style of Python Tutor:
// each object that a frame variable points to starts a row, and the objects it points to
// are placed to its right. An object is placed only once; later references to it are arrows.

import type { Frame, HeapObject, MemorySnapshot, Value, Variable } from '../src/model.ts';

export interface ViewOptions {
  showFunctions: boolean;
  showIds: boolean;
  /** Show the classes (with their static variables) in their own part at the top of the heap. */
  showClasses: boolean;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { showFunctions: false, showIds: true, showClasses: true };

/** The heap, ready to draw: class boxes in a row at the top, then rows of objects. */
export interface HeapLayout {
  /** Ids of the class boxes; a superclass comes before its subclasses. Empty when classes are hidden. */
  classes: number[];
  /** The rows of objects, from top to bottom. */
  rows: HeapTree[];
}

export interface HeapTree {
  id: number;
  children: HeapTree[];
}

/** True for functions and classes when "Show functions" is off: they are not drawn in the object rows. */
export function isHiddenObject(o: HeapObject | undefined, opts: ViewOptions): boolean {
  return !!o && !opts.showFunctions && (o.kind === 'function' || o.kind === 'class');
}

function isClassBox(o: HeapObject | undefined, opts: ViewOptions): boolean {
  return !!o && opts.showClasses && o.kind === 'class';
}

/** True when the value points to a function or class and functions are hidden. */
export function isHiddenRef(v: Value, snap: MemorySnapshot, opts: ViewOptions): boolean {
  return v.k === 'ref' && isHiddenObject(snap.objects[v.id], opts);
}

export function visibleVars(frame: Frame, snap: MemorySnapshot, opts: ViewOptions): Variable[] {
  return frame.vars.filter((v) => !isHiddenRef(v.value, snap, opts));
}

/**
 * The visible variables of a frame from the bottom up, as the view draws them: the variables of a scope build bottom
 * up, like the stack. The variables of an enclosing function (closure) come first, because that function ran first;
 * then the function's own variables, in the order of the program.
 */
export function varsBottomUp(frame: Frame, snap: MemorySnapshot, opts: ViewOptions): Variable[] {
  const vars = visibleVars(frame, snap, opts);
  return [...vars.filter((v) => v.scope === 'closure'), ...vars.filter((v) => v.scope !== 'closure')];
}

/** Ids that an object points to, in display order. */
export function refsOf(o: HeapObject): number[] {
  const out: number[] = [];
  const add = (v: Value) => {
    if (v.k === 'ref') out.push(v.id);
  };
  o.items?.forEach(add);
  o.fields?.forEach((f) => add(f.value));
  o.entries?.forEach((e) => {
    add(e.key);
    add(e.value);
  });
  return out;
}

/**
 * Builds the heap layout. Objects that frame variables point to start rows; the objects they point to
 * are placed to their right. `maxDepth` limits how far a row grows to the right; deeper objects start
 * a new row below. Classes go to their own list (when shown).
 *
 * The heap builds bottom up, like the stack: the rows of the Global scope are at the bottom, and the rows
 * of each newer function call are above them. In one scope, the rows of each variable are at the height of the
 * variable, which also build bottom up (varsBottomUp).
 * Objects that only a static variable points to start rows at the top, below the classes.
 * An object belongs to the oldest scope and the oldest variable that point to it, so it does not move when a function
 * is called or a new variable points to it.
 */
export function layoutHeap(snap: MemorySnapshot, opts: ViewOptions, maxDepth = 6): HeapLayout {
  const placed = new Set<number>();
  /** The rows of the scope (or of the classes) that is placed now. */
  let rows: HeapTree[] = [];
  const pending: number[] = [];

  const visit = (id: number, depth: number): HeapTree | undefined => {
    if (placed.has(id)) return undefined;
    const o = snap.objects[id];
    if (isClassBox(o, opts) || isHiddenObject(o, opts)) return undefined;
    placed.add(id);
    const node: HeapTree = { id, children: [] };
    if (!o) return node;
    for (const child of refsOf(o)) {
      if (placed.has(child)) continue;
      if (depth + 1 >= maxDepth) {
        if (!pending.includes(child)) pending.push(child);
        continue;
      }
      const c = visit(child, depth + 1);
      if (c) node.children.push(c);
    }
    return node;
  };

  const addRoot = (id: number) => {
    const t = visit(id, 0);
    if (t) rows.push(t);
    while (pending.length > 0) {
      const next = pending.shift()!;
      const t2 = visit(next, 0);
      if (t2) rows.push(t2);
    }
  };

  // snap.frames starts with the oldest scope, usually the Global scope.
  const scopeRows: HeapTree[][] = [];
  for (const frame of snap.frames) {
    // The rows of each variable, from the bottom up; a row that is too deep stays below the row it comes from.
    const rowsOfVars: HeapTree[][] = [];
    for (const v of varsBottomUp(frame, snap, opts)) {
      rows = [];
      if (v.value.k === 'ref') addRoot(v.value.id);
      rowsOfVars.push(rows);
    }
    scopeRows.push(rowsOfVars.reverse().flat());
  }
  rows = [];

  const classes: number[] = [];
  if (opts.showClasses) {
    const order: number[] = [];
    const note = (id: number | undefined) => {
      if (id !== undefined && snap.objects[id]?.kind === 'class' && !order.includes(id)) order.push(id);
    };
    for (const frame of snap.frames) {
      for (const v of frame.vars) if (v.value.k === 'ref') note(v.value.id);
    }
    const walk = (t: HeapTree) => {
      note(snap.objects[t.id]?.cls);
      t.children.forEach(walk);
    };
    scopeRows.flat().forEach(walk);
    for (const o of Object.values(snap.objects)) {
      note(o.cls);
      if (o.kind === 'class') note(o.id);
    }
    // A superclass comes before its subclasses, so the "extends" arrow points to the left.
    const add = (id: number, guard: number) => {
      if (classes.includes(id) || guard > 50) return;
      const sup = snap.objects[id]?.superId;
      if (sup !== undefined && snap.objects[sup]?.kind === 'class') add(sup, guard + 1);
      classes.push(id);
    };
    for (const id of order) add(id, 0);
    for (const id of classes) {
      for (const child of refsOf(snap.objects[id]!)) addRoot(child);
    }
  }
  return { classes, rows: [...rows, ...scopeRows.reverse().flat()] };
}
