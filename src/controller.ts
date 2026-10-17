// Connects the debugger with the memory panel: it watches the debug sessions, reads a new
// snapshot at every pause and sends it to the panel.

import * as vscode from 'vscode';
import type { FromWebview, MemorySnapshot, ToWebview } from './model.ts';
import { DEFAULT_LIMITS, type WalkerLimits } from './heapWalker.ts';
import { collectSnapshot } from './snapshot.ts';
import { MemoryPanel } from './panel.ts';

/** Requests that make the program run again. */
const RUN_COMMANDS = new Set(['continue', 'next', 'stepIn', 'stepOut', 'stepBack', 'reverseContinue', 'goto', 'restartFrame']);

interface PauseState {
  session: vscode.DebugSession;
  threadId: number;
}

export class MemoryController implements vscode.Disposable {
  private panel: MemoryPanel | undefined;
  private readonly steps = new Map<string, number>();
  private readonly autoOpened = new Set<string>();
  private paused: PauseState | undefined;
  private refreshSeq = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  /** The newest snapshot, for tests. */
  lastSnapshot: MemorySnapshot | undefined;
  private lastSessionId = '';
  /** All steps of the newest session, so that a panel that opens later has the whole history. */
  private history: MemorySnapshot[] = [];
  /** The last status message (running, ended, error), sent again to a panel that opens later. */
  private lastStatus: ToWebview | undefined;
  /**
   * Marks the line of an earlier step in the editor while the panel shows that step, as the debugger marks a stack
   * frame that you select and that is not the current position: an arrow in the gutter and a green line. The yellow
   * line of the debugger stays the current position of the program.
   */
  private readonly stepDecoration: vscode.TextEditorDecorationType;
  private viewedStep: Extract<FromWebview, { type: 'viewStep' }> | undefined;
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
    this.disposables.push(
      vscode.debug.registerDebugAdapterTrackerFactory('*', {
        createDebugAdapterTracker: (session) => ({
          onDidSendMessage: (m: any) => this.onAdapterMessage(session, m),
          onWillReceiveMessage: (m: any) => {
            if (m?.type === 'request' && RUN_COMMANDS.has(m.command)) this.onRunning(session);
          },
        }),
      }),
      vscode.debug.onDidTerminateDebugSession((s) => this.onTerminated(s)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.markViewedStep()),
      this.stepDecoration,
    );
    // `onDidChangeActiveStackItem` exists since VS Code 1.90.
    const debugApi = vscode.debug as any;
    if (typeof debugApi.onDidChangeActiveStackItem === 'function') {
      this.disposables.push(debugApi.onDidChangeActiveStackItem(() => this.postFocusFrame()));
    }
  }

  /** Opens (or shows) the panel. Reads the current pause if there is one. */
  open(): void {
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = MemoryPanel.create(
        this.extensionUri,
        {
          onDisposed: () => {
            this.panel = undefined;
            this.onViewStep(undefined);
          },
          onViewStep: (m) => this.onViewStep(m),
        },
        this.maxSteps(),
      );
      if (this.history.length > 0) {
        this.post({ type: 'history', snapshots: this.history, sessionId: this.lastSessionId });
      }
      if (this.lastStatus) this.post(this.lastStatus);
    }
    if (!this.paused) {
      const item = (vscode.debug as any).activeStackItem;
      if (item && item.session && typeof item.threadId === 'number') {
        this.paused = { session: item.session, threadId: item.threadId };
        this.scheduleRefresh();
      }
    }
  }

  /** Waits for the next snapshot (for tests). */
  nextSnapshot(timeoutMs = 30000): Promise<MemorySnapshot> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no snapshot')), timeoutMs);
      this.snapshotWaiters.push((s) => {
        clearTimeout(timer);
        resolve(s);
      });
    });
  }

  private post(msg: ToWebview): void {
    if (msg.type === 'status') this.lastStatus = msg;
    if (msg.type === 'snapshot' || msg.type === 'history') this.lastStatus = undefined;
    this.panel?.post(msg);
  }

  private maxSteps(): number {
    return vscode.workspace.getConfiguration('mindbug').get<number>('maxHistorySteps', 500);
  }

  /**
   * The panel shows another step. The editor shows the line of that step, as the debugger does at a pause, and an
   * earlier step gets its line marked. The line is already in the TypeScript file: VS Code's JavaScript debugger
   * maps the stack frames through Deno's source map.
   */
  private onViewStep(m: Extract<FromWebview, { type: 'viewStep' }> | undefined): void {
    this.viewedStep = m && !m.live && m.file && m.line ? m : undefined;
    this.markViewedStep();
    if (m?.file && m.line) void this.revealLine(m.file, m.line, !m.live);
  }

  /**
   * Scrolls the editor of `file` to `line`. When no editor shows the file, `open` opens it in the first column
   * (an earlier step can be in a file that is closed now); the live step only scrolls, because the debugger opens it.
   */
  private async revealLine(file: string, line: number, open: boolean): Promise<void> {
    const l = Math.max(0, line - 1);
    const range = new vscode.Range(l, 0, l, 0);
    let editor = vscode.window.visibleTextEditors.find((e) => sameFile(e.document.uri, file));
    if (!editor && open) {
      try {
        editor = await vscode.window.showTextDocument(vscode.Uri.file(file), {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true,
          preview: true,
        });
      } catch {
        return; // the file does not exist any more
      }
    }
    editor?.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  /** Shows the step with number `step` as the panel does when you select it in the step list (for tests). */
  viewStep(step: number): void {
    const i = this.history.findIndex((s) => s.step === step);
    const snap = this.history[i];
    if (!snap) return;
    const top = snap.frames[snap.frames.length - 1];
    this.onViewStep({ type: 'viewStep', step, live: i === this.history.length - 1, file: top?.file, line: top?.line });
  }

  private markViewedStep(): void {
    const m = this.viewedStep;
    for (const editor of vscode.window.visibleTextEditors) {
      if (!m || !m.file || !m.line || !sameFile(editor.document.uri, m.file)) {
        editor.setDecorations(this.stepDecoration, []);
        continue;
      }
      const line = Math.min(Math.max(0, m.line - 1), editor.document.lineCount - 1);
      editor.setDecorations(this.stepDecoration, [
        {
          range: new vscode.Range(line, 0, line, 0),
          hoverMessage: `Mindbug shows step ${m.step}. At that step the program was at this line.`,
        },
      ]);
    }
  }

  private onAdapterMessage(session: vscode.DebugSession, m: any): void {
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
    const config = vscode.workspace.getConfiguration('mindbug');
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
        if (!this.paused) this.post({ type: 'status', state: 'running', text: 'The program is running.' });
      }, 300);
    }
  }

  private onTerminated(session: vscode.DebugSession): void {
    if (this.paused?.session.id === session.id || this.lastSessionId === rootId(session)) {
      this.paused = undefined;
      this.refreshSeq++;
      this.post({ type: 'status', state: 'ended', text: 'The program has ended.' });
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 40);
  }

  private limits(): WalkerLimits {
    const c = vscode.workspace.getConfiguration('mindbug');
    return {
      objects: c.get<number>('maxObjects', DEFAULT_LIMITS.objects),
      items: c.get<number>('maxArrayItems', DEFAULT_LIMITS.items),
      fields: DEFAULT_LIMITS.fields,
      str: c.get<number>('maxStringLength', DEFAULT_LIMITS.str),
    };
  }

  private async refresh(): Promise<void> {
    const pause = this.paused;
    if (!pause) return;
    const seq = ++this.refreshSeq;
    const sessionKey = rootId(pause.session);
    const step = (this.steps.get(sessionKey) ?? 0) + 1;
    try {
      const snapshot = await collectSnapshot(
        { request: (command, args) => Promise.resolve(pause.session.customRequest(command, args)) },
        pause.threadId,
        step,
        { limits: this.limits() },
      );
      if (seq !== this.refreshSeq) return; // the program moved on; this result is old
      this.steps.set(sessionKey, step);
      this.lastSnapshot = snapshot;
      if (this.lastSessionId !== sessionKey) this.history = [];
      this.lastSessionId = sessionKey;
      this.history.push(snapshot);
      const max = this.maxSteps();
      if (this.history.length > max) this.history.splice(0, this.history.length - max);
      this.post({ type: 'snapshot', snapshot, sessionId: sessionKey });
      this.postFocusFrame();
      for (const w of this.snapshotWaiters.splice(0)) w(snapshot);
    } catch (e) {
      if (seq !== this.refreshSeq) return;
      const text = `The memory could not be read: ${e instanceof Error ? e.message : String(e)}`;
      this.post({ type: 'status', state: 'error', text });
    }
  }

  private postFocusFrame(): void {
    const item = (vscode.debug as any).activeStackItem;
    const frameId = item && typeof item.frameId === 'number' ? item.frameId : undefined;
    this.post({ type: 'focusFrame', frameId });
  }

  dispose(): void {
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel?.dispose();
  }
}

/**
 * VS Code's JavaScript debugger starts a parent session and a child session for the program.
 * Steps are counted per top-level session, so a restart starts a new history.
 */
function rootId(session: vscode.DebugSession): string {
  let s: vscode.DebugSession = session;
  while (s.parentSession) s = s.parentSession;
  return s.id;
}

function sameFile(uri: vscode.Uri, file: string): boolean {
  if (uri.scheme !== 'file') return uri.toString() === file;
  const a = uri.fsPath;
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === file.toLowerCase() : a === file;
}
