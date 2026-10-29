// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Connects the debugger with the memory panel: it watches the debug sessions, reads a new
// snapshot at every pause while the panel is open and sends it to the panel.

import * as vscode from 'vscode';
import { blockMarkLines, blockMarks, blockRanges, bracketPairs, type BlockMark, type BracketPair } from './blockRanges.ts';
import {
  DEFAULT_VIEW_OPTIONS,
  stepMarkText,
  VIEW_OPTION_NAMES,
  type Frame,
  type FromWebview,
  type MemorySnapshot,
  type ToWebview,
  type ViewOptions,
} from './model.ts';
import { DEFAULT_LIMITS, type WalkerLimits } from './heapWalker.ts';
import { collectSnapshot, type DapClient } from './snapshot.ts';
import { MemoryPanel } from './panel.ts';
import { V8Connection } from './v8Connection.ts';

/** Requests that make the program run again. */
const RUN_COMMANDS = new Set(['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'goto', 'restartFrame']);

/** The fields of a message of the Debug Adapter Protocol that the controller reads. */
interface DapMessage {
  type?: string;
  command?: string;
  event?: string;
  arguments?: { restart?: unknown };
  body?: { threadId?: unknown };
}

/**
 * True for a request that restarts the debug session: the request `restart`, or, for a debug adapter without it, the
 * requests `disconnect` and `terminate` with `restart: true`, after which VS Code starts the session again.
 */
function isRestart(m: DapMessage | undefined): boolean {
  if (m?.command === 'restart') return true;
  return (m?.command === 'disconnect' || m?.command === 'terminate') && m.arguments?.restart === true;
}

/**
 * The debug types of VS Code's JavaScript debugger for Node.js, whose sessions the view follows: "pwa-node"
 * (also the session of a configuration of type "mindbug", and the child session that runs the program), "node" and
 * "node-terminal" (the JavaScript Debug Terminal). The helper of src/heapWalker.ts is JavaScript, so the sessions of
 * other debuggers, for example of Python or Go, get no request of Mindbug.
 */
export const JS_DEBUG_TYPES = ['pwa-node', 'node', 'node-terminal'];

interface PauseState {
  session: vscode.DebugSession;
  threadId: number;
}

export class MemoryController implements vscode.Disposable {
  private panel: MemoryPanel | undefined;
  private readonly autoOpened = new Set<string>();
  private paused: PauseState | undefined;
  /** The pause of the newest snapshot. A pause while the panel was closed has no snapshot until the panel opens. */
  private readPause: PauseState | undefined;
  private refreshSeq = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** The connection to V8 of each debug session that paused, by the id of the session. */
  private readonly connections = new Map<string, Promise<V8Connection | undefined>>();
  /** The newest snapshot, for tests. */
  lastSnapshot: MemorySnapshot | undefined;
  /**
   * The debug session that ran the program of the history: the session that paused, which is the child session of
   * VS Code's JavaScript debugger. Undefined after a restart, until the new run pauses.
   */
  private lastSession: vscode.DebugSession | undefined;
  /** All steps of the newest run of the program, so that a panel that opens later has the whole history. */
  private history: MemorySnapshot[] = [];
  /** The last status message (running, ended, error), sent again to a panel that opens later. */
  private lastStatus: ToWebview | undefined;
  /**
   * Marks the line of an earlier step in the editor while the panel shows that step, as the debugger marks a stack
   * frame that you select and that is not the current position: an arrow in the gutter and a green line. The yellow
   * line of the debugger stays the current position of the program. A text at the end of the line names the step, so
   * that the green line needs no knowledge of the colors of the debugger.
   */
  private readonly stepDecoration: vscode.TextEditorDecorationType;
  /** The rectangles around the block scopes in the editor. Each line of a rectangle has its own CSS (blockMarkLines). */
  private readonly blockDecoration: vscode.TextEditorDecorationType;
  /** The block marks that each editor shows, by the URI of its document (for tests). */
  private readonly shownBlockMarks = new Map<string, BlockMark[]>();
  /** The brackets of the newest document that got block marks, for its version. */
  private brackets: { uri: string; version: number; pairs: BracketPair[] } | undefined;
  /** The earlier step that the view shows, with the file and the line of its running function; none for the newest step. */
  private viewedStep: { step: number; file: string; line: number } | undefined;
  /** The reveals of revealLine, one after the other: a reveal that waits for an editor to open must not undo a later one. */
  private revealing: Promise<void> = Promise.resolve();
  /** The saves of the switches, one after the other, so that the last click wins. */
  private saving: Promise<void> = Promise.resolve();
  /**
   * The saves of the switches that have not finished. Their own changes of the settings are not sent to the view: the
   * view already shows them, and an older value must not undo a newer click.
   */
  private pendingSaves = 0;
  /**
   * Clicks on switches that the settings of the workspace set. Mindbug does not change the settings of a workspace,
   * which are a file of the workspace (`.vscode/settings.json`), so these clicks last only until the view closes or
   * the setting changes.
   */
  private viewOverrides: Partial<ViewOptions> = {};
  /** The switches that the view shows: from the opening of the panel, the clicks, and the messages `viewOptions`. */
  private shownOptions: ViewOptions = { ...DEFAULT_VIEW_OPTIONS };
  /** Resolvers waiting for the next snapshot (used by tests). */
  private readonly snapshotWaiters: ((s: MemorySnapshot) => void)[] = [];

  private readonly extensionUri: vscode.Uri;
  private runningTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
    this.stepDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.focusedStackFrameHighlightBackground'),
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'step-arrow.svg'),
      gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor('debugIcon.breakpointStackframeForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });
    this.blockDecoration = vscode.window.createTextEditorDecorationType({});
    const tracker: vscode.DebugAdapterTrackerFactory = {
      createDebugAdapterTracker: (session) => ({
        onDidSendMessage: (m: DapMessage | undefined) => this.onAdapterMessage(session, m),
        onWillReceiveMessage: (m: DapMessage | undefined) => {
          if (m?.type !== 'request') return;
          if (m.command !== undefined && RUN_COMMANDS.has(m.command)) this.onRunning(session);
          if (isRestart(m)) this.onRestart(session);
        },
      }),
    };
    this.disposables.push(
      ...JS_DEBUG_TYPES.map((type) => vscode.debug.registerDebugAdapterTrackerFactory(type, tracker)),
      vscode.debug.onDidTerminateDebugSession((s) => {
        this.disconnect(s.id);
        this.onTerminated(s);
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.markViewedStep();
        this.markBlocks();
      }),
      // The marks of the blocks follow an edit of the file.
      vscode.workspace.onDidChangeTextDocument((e) => {
        const frame = this.shownFrame();
        if (frame?.file && sameFile(e.document.uri, frame.file)) this.markBlocks();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        const changed = VIEW_OPTION_NAMES.filter((name) => e.affectsConfiguration(`nimblescape.mindbug.${name}`));
        if (changed.length === 0 || this.pendingSaves > 0) return;
        for (const name of changed) delete this.viewOverrides[name];
        this.showViewOptions();
      }),
      this.stepDecoration,
      this.blockDecoration,
      vscode.debug.onDidChangeActiveStackItem(() => this.postFocusFrame()),
    );
  }

  /** Opens (or shows) the panel. Reads the current pause if there is one. */
  open(): void {
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.shownOptions = this.viewOptions();
      this.panel = MemoryPanel.create(
        this.extensionUri,
        {
          onDisposed: () => {
            this.panel = undefined;
            this.viewOverrides = {};
            this.onViewStep(undefined);
            // Mindbug reads the memory only while the panel is open: a read that runs now gives no step, and the
            // connections to V8 close. The step history stays for the panel that opens next.
            clearTimeout(this.refreshTimer);
            this.refreshSeq++;
            for (const id of [...this.connections.keys()]) this.disconnect(id);
          },
          onViewStep: (m) => this.onViewStep(m),
          onViewOption: (name, value) => void this.saveViewOption(name, value),
          onOpenLocation: (m) => this.openLocation(m.step, m.frame),
          onReady: () => this.onReady(),
        },
        this.maxSteps(),
        this.shownOptions,
      );
    }
    // Only a session of VS Code's JavaScript debugger: Mindbug sends no request to the debugger of another language.
    const item = vscode.debug.activeStackItem;
    if (!this.paused && item && JS_DEBUG_TYPES.includes(item.session.type)) {
      this.paused = { session: item.session, threadId: item.threadId };
    }
    // The pause can have come while the panel was closed, when Mindbug did not read it.
    if (this.paused && this.paused !== this.readPause) this.scheduleRefresh();
  }

  /**
   * The page of the view has loaded: the first time after `open`, and again after "Reload Webviews" or when the panel
   * moves to another window, which loads the page again without its steps. The page gets the switches (its HTML can
   * have older ones than the settings), the steps of the run, the last status and the frame selected in the Call Stack.
   */
  private onReady(): void {
    this.showViewOptions(true);
    if (this.history.length > 0) {
      this.post({ type: 'history', snapshots: this.history, sessionId: this.lastSession?.id ?? '' });
    }
    if (this.lastStatus) this.post(this.lastStatus);
    this.postFocusFrame();
  }

  /** The block marks in the editors of a file (for tests). */
  blockMarks(file: string): BlockMark[] {
    return [...this.shownBlockMarks].find(([uri]) => sameFile(vscode.Uri.parse(uri), file))?.[1] ?? [];
  }

  /** The step numbers of the history (for tests). */
  historySteps(): number[] {
    return this.history.map((s) => s.step);
  }

  /** Waits for the next snapshot (for tests). */
  nextSnapshot(timeoutMs = 30000): Promise<MemorySnapshot> {
    return new Promise((resolve, reject) => {
      // The message names the state of the program and the last status of the view, to find the cause in a test log.
      const waiter = (s: MemorySnapshot) => {
        clearTimeout(timer);
        resolve(s);
      };
      const timer = setTimeout(() => {
        const i = this.snapshotWaiters.indexOf(waiter);
        if (i >= 0) this.snapshotWaiters.splice(i, 1);
        const status = this.lastStatus?.type === 'status' ? `, status "${this.lastStatus.text}"` : '';
        reject(new Error(`no snapshot (program ${this.paused ? 'paused' : 'not paused'}${status})`));
      }, timeoutMs);
      this.snapshotWaiters.push(waiter);
    });
  }

  private post(msg: ToWebview): void {
    if (msg.type === 'status') this.lastStatus = msg;
    // A new step, or the empty history of a restart, ends what the last status says. The steps that a page gets again
    // (onReady) do not: the program can have ended after them.
    if (msg.type === 'snapshot' || (msg.type === 'history' && msg.snapshots.length === 0)) this.lastStatus = undefined;
    this.panel?.post(msg);
  }

  private maxSteps(): number {
    return vscode.workspace.getConfiguration('nimblescape.mindbug').get<number>('maxHistorySteps', 500);
  }

  /** The switches of the view: the settings, and the clicks on switches that the settings of the workspace set. */
  private viewOptions(): ViewOptions {
    const config = vscode.workspace.getConfiguration('nimblescape.mindbug');
    const opts = { ...DEFAULT_VIEW_OPTIONS };
    for (const name of VIEW_OPTION_NAMES) {
      const override = this.viewOverrides[name];
      const value = override !== undefined && config.inspect(name)?.workspaceValue !== undefined ? override : config.get<unknown>(name);
      if (typeof value === 'boolean') opts[name] = value;
    }
    return opts;
  }

  /**
   * The switch "Stop on entry" of the view, for the next start of a program: its setting, or a click on it that the
   * settings of the workspace overrule only in this window (see `viewOverrides`).
   */
  stopOnEntry(): boolean {
    return this.viewOptions().stopOnEntry;
  }

  /** Sends the switches to the view when they differ from the switches that it shows, or always with `force`. */
  private showViewOptions(force = false): void {
    const opts = this.viewOptions();
    if (!force && VIEW_OPTION_NAMES.every((name) => opts[name] === this.shownOptions[name])) return;
    this.shownOptions = opts;
    this.post({ type: 'viewOptions', opts });
    this.markBlocks();
  }

  /**
   * Saves a switch of the view in the user settings, so that the view has it again after it was closed and after a
   * restart of VS Code. A user setting with the default value is removed, so that the settings file keeps only what
   * you changed. A switch that the settings of the workspace set is not saved (see `viewOverrides`).
   */
  saveViewOption(name: keyof ViewOptions, value: boolean): Promise<void> {
    // The message comes from the page of the view: only the switches of the view, only true or false.
    if (!(VIEW_OPTION_NAMES as readonly string[]).includes(name) || typeof value !== 'boolean') return this.saving;
    this.shownOptions = { ...this.shownOptions, [name]: value };
    if (name === 'showScopeFrames') this.markBlocks();
    this.pendingSaves++;
    this.saving = this.saving
      .then(() => this.writeViewOption(name, value))
      .finally(() => {
        // After the last save, the view gets the settings again only if they differ, for example after a failed save.
        if (--this.pendingSaves === 0) this.showViewOptions();
      });
    return this.saving;
  }

  private async writeViewOption(name: keyof ViewOptions, value: boolean): Promise<void> {
    const config = () => vscode.workspace.getConfiguration('nimblescape.mindbug');
    try {
      if (config().inspect(name)?.workspaceValue !== undefined) {
        if (this.panel) this.viewOverrides[name] = value;
        return;
      }
      delete this.viewOverrides[name];
      if (config().get<unknown>(name) === value) return;
      await config().update(name, value === DEFAULT_VIEW_OPTIONS[name] ? undefined : value, vscode.ConfigurationTarget.Global);
      // In a remote window, the removal reaches only the remote user settings; a local user setting can still differ.
      if (config().get<unknown>(name) !== value) await config().update(name, value, vscode.ConfigurationTarget.Global);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`Mindbug could not save the setting nimblescape.mindbug.${name}: ${message}`);
    }
  }

  /**
   * The panel shows another step. The editor shows the line of that step, as the debugger does at a pause, and an
   * earlier step gets its line marked. The line is already in the TypeScript file: VS Code's JavaScript debugger
   * maps the stack frames through the source map of the runtime. The file and the line come from the step history of
   * the extension; a step that it does not have shows no line.
   */
  private onViewStep(m: Extract<FromWebview, { type: 'viewStep' }> | undefined): void {
    const snap = m && this.history.find((s) => s.step === m.step);
    const top = snap?.frames[snap.frames.length - 1];
    const at = m && top?.file && top.line ? { step: m.step, file: top.file, line: top.line } : undefined;
    this.viewedStep = m && !m.live ? at : undefined;
    this.markViewedStep();
    this.markBlocks();
    if (at) this.revealLine(at.file, at.line, !m?.live);
  }

  /**
   * Shows the line of a frame of a step in the editor, after a click on the title of its scope in the view. The file
   * and the line come from the step history of the extension.
   */
  private openLocation(step: number, frame: number): void {
    const f = this.history.find((s) => s.step === step)?.frames[frame];
    if (!f?.file) return;
    const line = Math.max(0, f.line - 1);
    void vscode.window
      .showTextDocument(vscode.Uri.file(f.file), {
        viewColumn: this.panel?.editorColumn() ?? vscode.ViewColumn.One,
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: false,
      })
      .then(undefined, () => undefined); // the file does not exist any more
  }

  /**
   * Scrolls the editor of `file` to `line`. When no editor shows the file, `open` opens it in the first column
   * (an earlier step can be in a file that is closed now); the live step only scrolls, because the debugger opens it.
   */
  private revealLine(file: string, line: number, open: boolean): void {
    this.revealing = this.revealing.then(() => this.revealNow(file, line, open)).catch(() => undefined);
  }

  private async revealNow(file: string, line: number, open: boolean): Promise<void> {
    const l = Math.max(0, line - 1);
    const range = new vscode.Range(l, 0, l, 0);
    let editor = vscode.window.visibleTextEditors.find((e) => sameFile(e.document.uri, file));
    if (!editor && open) {
      try {
        editor = await vscode.window.showTextDocument(vscode.Uri.file(file), {
          viewColumn: this.panel?.editorColumn() ?? vscode.ViewColumn.One,
          preserveFocus: true,
          preview: true,
        });
      } catch {
        return; // the file does not exist any more
      }
    }
    editor?.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /**
   * Shows the step with number `step` in the panel, as when you select it in the step list (for tests). The panel
   * then sends the `viewStep` message, in order after the messages it sent before.
   */
  viewStep(step: number): void {
    this.panel?.post({ type: 'showStep', step });
  }

  private markViewedStep(): void {
    const m = this.viewedStep;
    for (const editor of vscode.window.visibleTextEditors) {
      if (!m || !sameFile(editor.document.uri, m.file)) {
        editor.setDecorations(this.stepDecoration, []);
        continue;
      }
      const line = Math.min(Math.max(0, m.line - 1), editor.document.lineCount - 1);
      editor.setDecorations(this.stepDecoration, [
        {
          range: new vscode.Range(line, 0, line, 0),
          hoverMessage:
            `Mindbug shows step ${m.step}. At that step the program was at this line. ` +
            'While the program is paused, the yellow line of the debugger shows where it is now.',
          renderOptions: {
            after: {
              contentText: stepMarkText(m.step, this.history[this.history.length - 1]?.step),
              color: new vscode.ThemeColor('editorCodeLens.foreground'),
              fontStyle: 'italic',
              margin: '0 0 0 3em',
            },
          },
        },
      ]);
    }
  }

  /**
   * The running function of the step that the view shows: of the earlier step that the view shows, or of the newest
   * step while the program is paused. None without the view.
   */
  private shownFrame(): Frame | undefined {
    if (!this.panel) return undefined;
    const m = this.viewedStep;
    const snap = m ? this.history.find((s) => s.step === m.step) : this.paused ? this.history[this.history.length - 1] : undefined;
    return snap?.frames[snap.frames.length - 1];
  }

  /**
   * Marks the block scopes of the running function in the editor of its file: a rectangle around the lines of each
   * block scope, with the color of its part in the view.
   */
  private markBlocks(): void {
    try {
      this.showBlockMarks();
    } catch {
      // The marks only help to read the view: an error in them must not stop a step, which waits for this call.
      this.shownBlockMarks.clear();
    }
  }

  private showBlockMarks(): void {
    // The switch "Show scope frames" of the view hides the rectangles, and the parts of the block scopes in the view.
    const frame = this.shownOptions.showScopeFrames ? this.shownFrame() : undefined;
    this.shownBlockMarks.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      const doc = editor.document;
      const marks = frame?.file && frame.blocks?.length && sameFile(doc.uri, frame.file) ? this.blockMarksIn(editor, frame) : [];
      if (marks.length > 0) this.shownBlockMarks.set(doc.uri.toString(), marks);
      editor.setDecorations(
        this.blockDecoration,
        blockMarkLines(marks).map(({ line, css }) => ({
          range: new vscode.Range(line, 0, line, 0),
          renderOptions: { before: { contentText: '', textDecoration: css } },
        })),
      );
    }
  }

  private blockMarksIn(editor: vscode.TextEditor, frame: Frame): BlockMark[] {
    const doc = editor.document;
    const text = doc.getText();
    const uri = doc.uri.toString();
    if (this.brackets?.uri !== uri || this.brackets.version !== doc.version) {
      this.brackets = { uri, version: doc.version, pairs: bracketPairs(text) };
    }
    const line = Math.min(Math.max(0, frame.line - 1), doc.lineCount - 1);
    const offset = doc.offsetAt(new vscode.Position(line, Math.max(0, (frame.column ?? 1) - 1)));
    const ranges = blockRanges(text, offset, frame.blocks ?? [], this.brackets.pairs);
    const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;
    return ranges ? blockMarks(text, ranges, this.brackets.pairs, tabSize) : [];
  }

  private onAdapterMessage(session: vscode.DebugSession, m: DapMessage | undefined): void {
    if (m?.type !== 'event') return;
    switch (m.event) {
      case 'stopped': {
        const threadId = typeof m.body?.threadId === 'number' ? m.body.threadId : this.paused?.threadId ?? 1;
        this.onStopped(session, threadId);
        break;
      }
      case 'continued':
        this.onRunning(session);
        break;
      case 'terminated':
      case 'exited':
        this.onTerminated(session);
        break;
    }
  }

  private onStopped(session: vscode.DebugSession, threadId: number): void {
    this.paused = { session, threadId };
    const config = vscode.workspace.getConfiguration('nimblescape.mindbug');
    if (!this.panel && config.get<boolean>('openAutomatically', true) && !this.autoOpened.has(rootId(session))) {
      this.autoOpened.add(rootId(session));
      this.open();
    }
    this.scheduleRefresh();
  }

  private onRunning(session: vscode.DebugSession): void {
    if (this.paused && this.paused.session.id === session.id) {
      this.paused = undefined;
      this.refreshSeq++;
      // A step usually pauses again at once. Show "running" only when it takes longer,
      // so the diagram does not flicker at every step.
      if (this.runningTimer) clearTimeout(this.runningTimer);
      this.runningTimer = setTimeout(() => {
        if (this.paused) return;
        this.post({ type: 'status', state: 'running', text: 'The program is running.' });
        this.markBlocks();
      }, 300);
    }
  }

  /**
   * The end of the session of the program, or of one of its parent sessions, ends the program. After a restart, VS Code
   * can report the end of the session of the earlier run late, while the new run is already paused: that end does not
   * count.
   */
  private onTerminated(session: vscode.DebugSession): void {
    const current = this.paused?.session ?? this.lastSession;
    if (!current || !isSessionOrParent(session, current)) return;
    this.paused = undefined;
    this.refreshSeq++;
    this.post({ type: 'status', state: 'ended', text: 'The program has ended.' });
    this.markBlocks();
  }

  /**
   * A restart runs the program again from its start, so the steps of the earlier run go away at once, and the steps of
   * the new run count from 1. VS Code sends the restart to the top-level session; VS Code's JavaScript debugger then
   * ends the child session of the earlier run and starts a new child session.
   */
  private onRestart(session: vscode.DebugSession): void {
    const current = this.paused?.session ?? this.lastSession;
    if (!current || rootId(current) !== rootId(session)) return;
    this.paused = undefined;
    this.refreshSeq++;
    this.lastSession = undefined;
    this.history = [];
    this.onViewStep(undefined);
    this.post({ type: 'history', snapshots: [], sessionId: '' });
  }

  /**
   * Reads the memory of the current pause soon. Only while the panel is open: with the panel closed, Mindbug sends no
   * request to the debugger and runs no helper in the program.
   */
  private scheduleRefresh(): void {
    if (!this.panel) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 40);
  }

  private limits(): WalkerLimits {
    const c = vscode.workspace.getConfiguration('nimblescape.mindbug');
    return {
      objects: c.get<number>('maxObjects', DEFAULT_LIMITS.objects),
      items: c.get<number>('maxArrayItems', DEFAULT_LIMITS.items),
      fields: DEFAULT_LIMITS.fields,
      str: c.get<number>('maxStringLength', DEFAULT_LIMITS.str),
    };
  }

  private async refresh(): Promise<void> {
    const pause = this.paused;
    if (!pause || !this.panel) return;
    const seq = ++this.refreshSeq;
    // The steps count the pauses that Mindbug read in one run of the program, which is one session of the JavaScript
    // debugger. A pause while the panel was closed is not a step.
    const sameRun = this.lastSession?.id === pause.session.id;
    const step = sameRun ? (this.history[this.history.length - 1]?.step ?? 0) + 1 : 1;
    try {
      const dap: DapClient = {
        request: (command, args) => Promise.resolve(pause.session.customRequest(command, args)),
      };
      const v8 = await this.connect(pause.session, dap);
      const snapshot = await collectSnapshot(dap, v8, pause.threadId, step, { limits: this.limits() });
      if (seq !== this.refreshSeq) return; // the program moved on; this result is old
      this.lastSnapshot = snapshot;
      if (!sameRun) {
        // A new run starts a new history, and the view shows its newest step.
        this.history = [];
        this.viewedStep = undefined;
      }
      this.lastSession = pause.session;
      this.readPause = pause;
      this.history.push(snapshot);
      const max = this.maxSteps();
      if (this.history.length > max) this.history.splice(0, this.history.length - max);
      this.post({ type: 'snapshot', snapshot, sessionId: pause.session.id });
      // The view stays at an earlier step; the text at its line names the new newest step.
      this.markViewedStep();
      this.markBlocks();
      this.postFocusFrame();
      for (const w of this.snapshotWaiters.splice(0)) w(snapshot);
    } catch (e) {
      if (seq !== this.refreshSeq) return;
      const text = `The memory could not be read: ${e instanceof Error ? e.message : String(e)}`;
      this.post({ type: 'status', state: 'error', text });
    }
  }

  /**
   * The connection to V8 of a debug session. The first step of a session opens it; later steps use it again. When it
   * is closed or could not be opened, the next step opens a new one.
   */
  private async connect(session: vscode.DebugSession, dap: DapClient): Promise<V8Connection> {
    const known = await this.connections.get(session.id);
    if (known && !known.closed) return known;
    const opening = V8Connection.open(dap);
    this.connections.set(session.id, opening);
    const connection = await opening;
    if (!connection) {
      if (this.connections.get(session.id) === opening) this.connections.delete(session.id);
      throw new Error("no connection to V8 through VS Code's JavaScript debugger");
    }
    return connection;
  }

  private disconnect(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    this.connections.delete(sessionId);
    void connection?.then((c) => c?.dispose());
  }

  private postFocusFrame(): void {
    const item = vscode.debug.activeStackItem;
    this.post({ type: 'focusFrame', frameId: item && 'frameId' in item ? item.frameId : undefined });
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.runningTimer);
    this.refreshSeq++;
    // The panel first: its end clears the marks in the editors, which need the decorations.
    this.panel?.dispose();
    for (const id of [...this.connections.keys()]) this.disconnect(id);
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

/**
 * VS Code's JavaScript debugger starts a parent session and a child session for the program. The view opens by itself
 * once for each top-level session, and VS Code sends a restart to the top-level session.
 */
function rootId(session: vscode.DebugSession): string {
  let s: vscode.DebugSession = session;
  while (s.parentSession) s = s.parentSession;
  return s.id;
}

/** True when `ancestor` is `session` or one of its parent sessions. */
function isSessionOrParent(ancestor: vscode.DebugSession, session: vscode.DebugSession): boolean {
  for (let s: vscode.DebugSession | undefined = session; s; s = s.parentSession) {
    if (s.id === ancestor.id) return true;
  }
  return false;
}

function sameFile(uri: vscode.Uri, file: string): boolean {
  if (uri.scheme !== 'file') return uri.toString() === file;
  const a = uri.fsPath;
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === file.toLowerCase() : a === file;
}
