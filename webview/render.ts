// Builds the HTML of the frames column and the heap column.
// Arrows are drawn afterwards by arrows.ts, from the `.ptr` dots to the `.obj` boxes.

import type { ChangeSet, Frame, HeapObject, MemorySnapshot, Value } from '../src/model.ts';
import { slotKey, varKey } from '../src/changes.ts';
import { isHiddenRef, layoutHeap, varsBottomUp, type HeapTree, type ViewOptions } from './layout.ts';

export interface RenderInput {
  snap: MemorySnapshot;
  changes: ChangeSet;
  opts: ViewOptions;
  /** Frame selected in the VS Code Call Stack view (only for the current step). */
  focusFrameId?: number;
  /** False when the panel shows an earlier step of the history. */
  live?: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Text of a primitive value, as a student would write it in TypeScript. */
export function valueText(v: Value): string {
  switch (v.k) {
    case 'num':
    case 'big':
    case 'sym':
    case 'text':
      return v.v;
    case 'str': {
      const quoted = JSON.stringify(v.v);
      return v.cut ? `${quoted.slice(0, -1)}…"` : quoted;
    }
    case 'bool':
      return String(v.v);
    case 'undef':
      return 'undefined';
    case 'null':
      return 'null';
    case 'uninit':
      return 'uninitialized';
    case 'hole':
      return '';
    case 'accessor':
      return v.get && v.set ? 'get/set' : v.get ? 'get' : 'set';
    case 'unavail':
      return '?';
    case 'ref':
      return `#${v.id}`;
  }
}

function functionLabel(o: HeapObject): string {
  return o.kind === 'class' ? `class ${o.type}` : `ƒ ${o.type}`;
}

/** The content of a cell: a primitive as text, or a dot that an arrow starts from. */
export function renderValue(v: Value, snap: MemorySnapshot, opts: ViewOptions): HTMLElement {
  if (v.k === 'ref') {
    const target = snap.objects[v.id];
    if (isHiddenRef(v, snap, opts) && target) {
      const s = el('span', 'val fn-inline', functionLabel(target));
      s.title = target.text ?? target.type;
      return s;
    }
    const ptr = el('span', 'ptr');
    ptr.dataset.target = String(v.id);
    ptr.title = target ? `points to :${target.type} (id ${v.id})` : `points to object id ${v.id}`;
    return ptr;
  }
  const s = el('span', `val v-${v.k}`, valueText(v));
  if (v.k === 'unavail' && v.v) s.title = v.v;
  if (v.k === 'uninit') s.title = 'This variable is declared, but the line that gives it a value has not run yet.';
  if (v.k === 'accessor') s.title = 'A getter or setter. It is not called, because calling it could change the program.';
  if (v.k === 'str' && v.cut) s.title = 'The text is longer; only the beginning is shown.';
  return s;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The triangle at the left of the scope that runs, in the colors of the debugger's arrow in the editor:
 * yellow at the current step, green at an earlier step.
 */
function runsMark(live: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', live ? 'runs-mark' : 'runs-mark past');
  svg.setAttribute('viewBox', '0 0 10 14');
  svg.setAttribute('role', 'img');
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = live ? 'This function runs now.' : 'This function ran at this earlier step.';
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M1 1L9 7L1 13Z');
  svg.append(title, path);
  return svg;
}

function renderFrame(frame: Frame, index: number, input: RenderInput, isTop: boolean): HTMLElement {
  const { snap, changes, opts } = input;
  const box = el('div', 'frame');
  if (isTop) box.classList.add('active');
  if (input.focusFrameId !== undefined && input.focusFrameId === frame.frameId && !isTop) box.classList.add('focused');
  box.dataset.frameId = String(frame.frameId);

  const title = el('div', 'frame-title');
  const label = el('span', 'frame-label');
  label.append(el('span', 'frame-name', frame.name));
  if (!frame.isGlobal) label.append(el('span', 'frame-line', `:${frame.line}`));
  title.append(label);
  if (frame.file) {
    title.title = `${frame.file}, line ${frame.line} (click to show the line)`;
    title.classList.add('link');
    title.dataset.file = frame.file;
    title.dataset.line = String(frame.line);
  }
  box.append(title);
  if (isTop) box.append(runsMark(input.live !== false));

  // The variables build bottom up, like the stack: the first variable of the function is at the bottom.
  const vars = varsBottomUp(frame, snap, opts).reverse();
  if (vars.length === 0) {
    box.append(el('div', 'frame-empty', 'no variables'));
  }
  const grid = el('div', 'vars');
  let lastScope: string | undefined;
  for (const v of vars) {
    if (v.scope === 'closure' && lastScope !== 'closure') {
      const sep = el('div', 'scope-sep', 'from the enclosing function');
      sep.title = 'These variables belong to an outer function. This function can still use them (closure).';
      grid.append(sep);
    }
    lastScope = v.scope;
    const changed = changes.vars.has(varKey(index, frame.name, v.name));
    const n = el('div', 'var-name', v.name);
    if (v.name === 'this') n.classList.add('this');
    const slot = el('div', 'slot');
    if (changed) slot.classList.add('changed');
    if (v.value.k === 'ref') slot.classList.add('has-ptr');
    slot.append(renderValue(v.value, snap, opts));
    grid.append(n, slot);
  }
  box.append(grid);
  if (frame.note) box.append(el('div', 'frame-note', frame.note));
  return box;
}

export function renderFrames(container: HTMLElement, input: RenderInput): void {
  container.replaceChildren();
  const frames = input.snap.frames;
  if (frames.length === 0) {
    container.append(el('div', 'frame-empty', 'The program is paused outside your own code.'));
    return;
  }
  // The stack builds bottom up: the Global scope is at the bottom, and the function that runs now is on top.
  for (let i = frames.length - 1; i >= 0; i--) container.append(renderFrame(frames[i], i, input, i === frames.length - 1));
}

function idTag(o: HeapObject, opts: ViewOptions): HTMLElement | undefined {
  if (!opts.showIds) return undefined;
  const t = el('span', 'oid', `id ${o.id}`);
  t.title = 'Object id: two arrows to the same id mean the same object.';
  return t;
}

function slotClass(id: number, slot: string, changes: ChangeSet): string {
  return changes.slots.has(slotKey(id, slot)) ? ' changed' : '';
}

function renderArray(o: HeapObject, input: RenderInput): HTMLElement {
  const { snap, changes, opts } = input;
  const box = el('div', 'obj array');
  const label = el('div', 'obj-label');
  label.append(el('span', 'type', `:${o.type}`), el('span', 'dim', `length ${o.length ?? o.items?.length ?? 0}`));
  const tag = idTag(o, opts);
  if (tag) label.append(tag);
  box.append(label);
  const cells = el('div', 'cells');
  (o.items ?? []).forEach((v, i) => {
    const c = el('div', `cell${slotClass(o.id, String(i), changes)}`);
    c.append(el('div', 'idx', String(i)));
    const cv = el('div', 'cv');
    cv.append(renderValue(v, snap, opts));
    c.append(cv);
    cells.append(c);
  });
  if ((o.items ?? []).length === 0) cells.append(el('div', 'cell empty-cells', 'empty'));
  if (o.more) cells.append(el('div', 'cell more', `… ${o.more} more`));
  box.append(cells);
  return box;
}

function renderSet(o: HeapObject, input: RenderInput): HTMLElement {
  const { snap, changes, opts } = input;
  const box = el('div', 'obj array set');
  const label = el('div', 'obj-label');
  label.append(el('span', 'type', `:${o.type}`), el('span', 'dim', `size ${(o.items ?? []).length + (o.more ?? 0)}`));
  const tag = idTag(o, opts);
  if (tag) label.append(tag);
  box.append(label);
  const cells = el('div', 'cells');
  for (const v of o.items ?? []) {
    const c = el('div', `cell${slotClass(o.id, `s:${JSON.stringify(v)}`, changes)}`);
    const cv = el('div', 'cv');
    cv.append(renderValue(v, snap, opts));
    c.append(cv);
    cells.append(c);
  }
  if ((o.items ?? []).length === 0) cells.append(el('div', 'cell empty-cells', 'empty'));
  if (o.more) cells.append(el('div', 'cell more', `… ${o.more} more`));
  box.append(cells);
  return box;
}

function umlBox(o: HeapObject, input: RenderInput, extraClass: string): { box: HTMLElement; body: HTMLElement } {
  const box = el('div', `obj uml ${extraClass}`);
  const head = el('div', 'uml-head');
  head.append(el('span', 'uml-name', `:${o.type}`));
  const tag = idTag(o, input.opts);
  if (tag) head.append(tag);
  box.append(head);
  const body = el('div', 'uml-body');
  box.append(body);
  return { box, body };
}

function renderObject(o: HeapObject, input: RenderInput): HTMLElement {
  const { snap, changes, opts } = input;
  const { box, body } = umlBox(o, input, 'object');
  const table = el('table', 'attrs');
  for (const f of o.fields ?? []) {
    const row = el('tr', `attr${slotClass(o.id, `.${f.name}`, changes)}`);
    const val = el('td', 'attr-value');
    val.append(renderValue(f.value, snap, opts));
    row.append(el('td', 'attr-name', f.name), el('td', 'attr-eq', '='), val);
    table.append(row);
  }
  body.append(table);
  if (o.more) body.append(el('div', 'more-line', `… ${o.more} more attributes`));
  return box;
}

function renderMap(o: HeapObject, input: RenderInput): HTMLElement {
  const { snap, changes, opts } = input;
  const { box, body } = umlBox(o, input, 'map');
  const table = el('table', 'entries');
  const head = el('tr', 'entries-head');
  head.append(el('th', undefined, 'key'), el('th', undefined, 'value'));
  table.append(head);
  for (const e of o.entries ?? []) {
    const row = el('tr', `entry${slotClass(o.id, `k:${JSON.stringify(e.key)}`, changes)}`);
    const k = el('td', 'entry-key');
    k.append(renderValue(e.key, snap, opts));
    const v = el('td', 'entry-value');
    v.append(renderValue(e.value, snap, opts));
    row.append(k, v);
    table.append(row);
  }
  body.append(table);
  if ((o.entries ?? []).length === 0) body.append(el('div', 'more-line', 'empty'));
  if (o.more) body.append(el('div', 'more-line', `… ${o.more} more entries`));
  return box;
}

/** A class in UML class notation: name, static variables, attributes of each object, methods. */
function renderClass(o: HeapObject, input: RenderInput): HTMLElement {
  const { snap, changes, opts } = input;
  const box = el('div', 'obj uml class-box');
  const head = el('div', 'class-head');
  head.append(el('div', 'stereo', '«class»'), el('div', 'class-name', o.type));
  const sup = o.superId !== undefined ? snap.objects[o.superId] : undefined;
  if (o.superId !== undefined) {
    head.append(el('div', 'extends', `extends ${sup?.type ?? '?'}`));
    box.dataset.super = String(o.superId);
  }
  const tag = idTag(o, opts);
  if (tag) head.append(tag);
  box.append(head);

  const compartment = (caption: string, title: string) => {
    const c = el('div', 'compartment');
    const cap = el('div', 'caption', caption);
    cap.title = title;
    c.append(cap);
    box.append(c);
    return c;
  };
  const none = () => el('div', 'none', 'none');

  const statics = compartment(
    'static variables',
    'Class variables: they belong to the class, not to one object. There is one value for the whole class.',
  );
  const fields = o.fields ?? [];
  if (fields.length === 0) statics.append(none());
  else {
    const table = el('table', 'attrs');
    for (const f of fields) {
      const row = el('tr', `attr${slotClass(o.id, `.${f.name}`, changes)}`);
      const val = el('td', 'attr-value');
      val.append(renderValue(f.value, snap, opts));
      const name = el('td', 'attr-name');
      name.append(el('span', 'static', f.name));
      row.append(name, el('td', 'attr-eq', '='), val);
      table.append(row);
    }
    statics.append(table);
  }
  if (o.more) statics.append(el('div', 'more-line', `… ${o.more} more`));

  const attrs = compartment('each object has', 'The attributes that each object made from this class gets.');
  if ((o.attrs ?? []).length === 0) attrs.append(none());
  for (const a of o.attrs ?? []) attrs.append(el('div', 'member', a));

  const methods = compartment('methods', 'Underlined methods are static: you call them on the class, not on an object.');
  if ((o.methods ?? []).length === 0) methods.append(none());
  for (const m of o.methods ?? []) {
    const line = el('div', 'member');
    if (m.isStatic) line.append(el('span', 'static', m.name));
    else line.textContent = m.name;
    methods.append(line);
  }
  return box;
}

function renderSimple(o: HeapObject, input: RenderInput): HTMLElement {
  if (o.kind === 'function' || o.kind === 'class') {
    const box = el('div', 'obj function');
    const head = el('div', 'fn-head', functionLabel(o));
    const tag = idTag(o, input.opts);
    if (tag) head.append(tag);
    box.append(head);
    if (o.text) box.append(el('div', 'fn-text', o.text));
    return box;
  }
  const { box, body } = umlBox(o, input, 'value');
  if (o.text) body.append(el('div', 'value-text', o.text));
  return box;
}

function renderHeapObject(id: number, input: RenderInput): HTMLElement {
  const o = input.snap.objects[id];
  let box: HTMLElement;
  if (!o) {
    box = el('div', 'obj missing', '… not loaded');
    box.title = 'This object was not read, because the program has too many objects. Increase "nimblescape.mindbug.maxObjects" to see more.';
  } else if (o.kind === 'array') {
    box = renderArray(o, input);
  } else if (o.kind === 'set') {
    box = renderSet(o, input);
  } else if (o.kind === 'map') {
    box = renderMap(o, input);
  } else if (o.kind === 'object') {
    box = renderObject(o, input);
  } else if (o.kind === 'class' && input.opts.showClasses) {
    box = renderClass(o, input);
  } else {
    box = renderSimple(o, input);
  }
  box.dataset.id = String(id);
  if (o?.cls !== undefined && input.opts.showClasses && input.snap.objects[o.cls]) box.dataset.cls = String(o.cls);
  if (input.changes.newObjects.has(id)) box.classList.add('new');
  return box;
}

function renderTree(t: HeapTree, input: RenderInput): HTMLElement {
  const wrap = el('div', 'tree');
  wrap.append(renderHeapObject(t.id, input));
  if (t.children.length > 0) {
    const kids = el('div', 'kids');
    for (const c of t.children) kids.append(renderTree(c, input));
    wrap.append(kids);
  }
  return wrap;
}

function partLabel(title: string, text: string): HTMLElement {
  const wrap = el('div', 'part-label');
  wrap.append(el('div', 'part-title', title), el('div', 'part-sub', text));
  return wrap;
}

export function renderHeap(container: HTMLElement, input: RenderInput): void {
  container.replaceChildren();
  const { classes, rows } = layoutHeap(input.snap, input.opts);
  if (classes.length === 0 && rows.length === 0) {
    container.append(el('div', 'heap-empty', 'No objects yet.'));
    return;
  }
  if (classes.length > 0) {
    const part = el('div', 'heap-part classes-part');
    part.append(partLabel('CLASSES', 'The templates for objects. Each class exists once. Its static variables live here.'));
    const row = el('div', 'class-row');
    for (const id of classes) row.append(renderHeapObject(id, input));
    part.append(row);
    container.append(part);
  }
  const part = el('div', 'heap-part objects-part');
  if (classes.length > 0) part.append(partLabel('OBJECTS', 'Made with new. Each object has its own values.'));
  const list = el('div', 'rows');
  if (rows.length === 0) list.append(el('div', 'heap-empty', 'No objects yet.'));
  for (const r of rows) list.append(renderTree(r, input));
  part.append(list);
  container.append(part);
}
