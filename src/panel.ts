// The webview panel "Mindbug" beside the editor that shows the memory diagram.

import * as vscode from 'vscode';
import type { FromWebview, ToWebview } from './model.ts';
import { webviewHtml } from './webviewHtml.ts';

export interface MemoryPanelHandlers {
  onDisposed(): void;
  /** The panel shows another step (see the `viewStep` message). */
  onViewStep(msg: Extract<FromWebview, { type: 'viewStep' }>): void;
}

export class MemoryPanel {
  static readonly viewType = 'mindbug.memory';

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private readonly queue: ToWebview[] = [];
  private handlers: MemoryPanelHandlers | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, maxSteps: number) {
    this.panel = panel;
    const webview = panel.webview;
    const dist = vscode.Uri.joinPath(extensionUri, 'dist');
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    webview.html = webviewHtml({
      cspSource: webview.cspSource,
      nonce: makeNonce(),
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css')).toString(),
      maxSteps,
    });
    webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m), null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static create(extensionUri: vscode.Uri, handlers: MemoryPanelHandlers, maxSteps: number): MemoryPanel {
    const panel = vscode.window.createWebviewPanel(
      MemoryPanel.viewType,
      'Mindbug',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')] },
    );
    panel.iconPath = {
      light: vscode.Uri.joinPath(extensionUri, 'media', 'memory-light.svg'),
      dark: vscode.Uri.joinPath(extensionUri, 'media', 'memory-dark.svg'),
    };
    const p = new MemoryPanel(panel, extensionUri, maxSteps);
    p.handlers = handlers;
    return p;
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  post(msg: ToWebview): void {
    if (!this.ready) {
      // Keep only the newest message of each type until the page has loaded.
      // A full history replaces everything that came before it.
      if (msg.type === 'history') this.queue.length = 0;
      const i = this.queue.findIndex((q) => q.type === msg.type && msg.type !== 'snapshot');
      if (i >= 0) this.queue.splice(i, 1);
      this.queue.push(msg);
      return;
    }
    void this.panel.webview.postMessage(msg);
  }

  private onMessage(m: FromWebview): void {
    if (m.type === 'ready') {
      this.ready = true;
      for (const q of this.queue.splice(0)) void this.panel.webview.postMessage(q);
    } else if (m.type === 'viewStep') {
      this.handlers?.onViewStep(m);
    } else if (m.type === 'openLocation') {
      const uri = vscode.Uri.file(m.file);
      const line = Math.max(0, m.line - 1);
      void vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.One,
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: false,
      });
    }
  }

  dispose(): void {
    while (this.disposables.length) this.disposables.pop()?.dispose();
    this.panel.dispose();
    const h = this.handlers;
    this.handlers = undefined;
    h?.onDisposed();
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
