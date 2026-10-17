// Data model of one memory snapshot. The extension builds it, the webview draws it.
// The heap walker (src/heapWalker.ts) produces the same Value and HeapObject shapes.

/** A value in a variable, an array cell, an object field or a map entry. */
export type Value =
  | { k: 'num'; v: string }
  | { k: 'str'; v: string; cut?: boolean }
  | { k: 'bool'; v: boolean }
  | { k: 'undef' }
  | { k: 'null' }
  | { k: 'big'; v: string }
  | { k: 'sym'; v: string }
  /** A reference to a heap object. */
  | { k: 'ref'; id: number }
  /** A `let`/`const`/`class` binding that is not initialized yet. */
  | { k: 'uninit' }
  /** An empty slot in a sparse array. */
  | { k: 'hole' }
  /** A getter/setter property. The getter is never called. */
  | { k: 'accessor'; get: boolean; set: boolean }
  /** The value could not be read. */
  | { k: 'unavail'; v?: string }
  /** Plain text from the debugger, used when the heap walker cannot run. */
  | { k: 'text'; v: string };

export type HeapObjectKind = 'array' | 'object' | 'map' | 'set' | 'function' | 'class' | 'value';

export interface Field {
  name: string;
  value: Value;
}

export interface MapEntry {
  key: Value;
  value: Value;
}

export interface HeapObject {
  /** Stable id: the same object keeps the same id from step to step. */
  id: number;
  kind: HeapObjectKind;
  /** Class name ("Person", "Object"), "Array", "Map", "Set", "Date", function or class name, ... */
  type: string;
  /** Array elements and Set members. */
  items?: Value[];
  /** Real length of an array (items may be cut). */
  length?: number;
  /** Object attributes. */
  fields?: Field[];
  /** Map entries. */
  entries?: MapEntry[];
  /** Short text for functions (signature) and value objects (Date, RegExp, ...). */
  text?: string;
  /** Number of items, fields or entries that are not shown because of the limits. */
  more?: number;
  /** For an object made by a user class (`new Person()`): the id of that class. */
  cls?: number;
  /** For a class: the attributes that each object of the class gets (declared fields). */
  attrs?: string[];
  /** For a class: its methods. Its static variables (class variables) are in `fields`. */
  methods?: Method[];
  /** For a class that extends another user class: the id of the superclass. */
  superId?: number;
}

export interface Method {
  /** "birthday()", "get fullName", "set age" or "get/set age". */
  name: string;
  isStatic: boolean;
}

export type ScopeKind = 'local' | 'block' | 'closure' | 'module';

export interface Variable {
  name: string;
  value: Value;
  scope: ScopeKind;
}

export interface Frame {
  /** DAP frame id; only valid while the program is paused at this step. */
  frameId: number;
  /** Function name, or "Global scope" for the module top level. */
  name: string;
  isGlobal: boolean;
  line: number;
  file?: string;
  vars: Variable[];
  /** Set when the frame could not be read completely. */
  note?: string;
}

export interface MemorySnapshot {
  /** Counts up with every pause of the same debug session. */
  step: number;
  /** Frames from the oldest (global) to the newest (running) call. */
  frames: Frame[];
  objects: Record<number, HeapObject>;
  /** Ids of objects that were reached but not read because of the object limit. */
  missing: number[];
  reason?: string;
  /** Short location text, for example "sort.ts:34". */
  location?: string;
  /** True when the heap walker could not run; values are then plain debugger text. */
  fallback?: boolean;
}

/** State of the debugged program, shown in the status line of the panel. */
export type ProgramState = 'paused' | 'running' | 'ended' | 'idle' | 'error';

/** Messages from the extension to the webview. */
export type ToWebview =
  /** A new pause. `sessionId` changes when a new debug session starts (the history is reset). */
  | { type: 'snapshot'; snapshot: MemorySnapshot; sessionId: string }
  /** All steps of the session so far. Sent when the panel opens while a session has steps. */
  | { type: 'history'; snapshots: MemorySnapshot[]; sessionId: string }
  | { type: 'status'; state: Exclude<ProgramState, 'paused'>; text: string }
  /** The frame selected in the VS Code Call Stack view. */
  | { type: 'focusFrame'; frameId: number | undefined };

/** Messages from the webview to the extension. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'openLocation'; file: string; line: number }
  /**
   * The step that the panel shows. `live` is true for the newest step.
   * For an earlier step, the extension marks its line in the editor.
   */
  | { type: 'viewStep'; step: number; live: boolean; file?: string; line?: number };

/**
 * What changed since the previous snapshot.
 * - vars: keys made with `varKey`
 * - slots: keys made with `slotKey` (array cells, object fields, map entries, set members)
 */
export interface ChangeSet {
  vars: Set<string>;
  slots: Set<string>;
  newObjects: Set<number>;
}
