// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A connection to V8, the JavaScript engine of Deno and Node.js, with the Chrome DevTools Protocol (CDP). VS Code's
// JavaScript debugger gives it to other extensions: the DAP request `requestCDPProxy` returns the address of a
// WebSocket server of the debugger, which sends each request on to V8. The server runs on the computer of the
// debugger, which is also the computer of Mindbug (both are workspace extensions), so the requests do not go through
// the window of a remote session, as the requests of the Debug Adapter Protocol (DAP) do.
// This file does not import 'vscode'.

import type { DapClient } from './snapshot.ts';

/** A value in V8 (Runtime.RemoteObject). */
export interface CdpRemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
}

/** A scope of a call frame (Debugger.Scope). */
export interface CdpScope {
  /** "local", "block", "closure", "catch", "with", "module", "script", "eval" or "global" */
  type: string;
  name?: string;
  object: CdpRemoteObject;
  /** Where the scope starts in the code that the runtime runs; V8 gives it for the scopes of functions and blocks. */
  startLocation?: CdpLocation;
}

/** A position in a script of V8 (Debugger.Location): line and column count from 0. */
export interface CdpLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

/** A call frame of a pause (Debugger.CallFrame). */
export interface CdpCallFrame {
  callFrameId: string;
  functionName: string;
  url: string;
  scopeChain: CdpScope[];
  this: CdpRemoteObject;
  returnValue?: CdpRemoteObject;
}

/** The part of a CDP connection that the collector needs. The tests use the V8 inspector of Deno directly. */
export interface CdpClient {
  /** The call frames of the current pause, the newest first, or none when the program runs. */
  callFrames(): Promise<CdpCallFrame[]>;
  send(method: string, params?: object): Promise<any>;
}

/** The time after which a request without an answer fails, so that a step never waits for ever. */
const TIMEOUT_MS = 5000;

export class V8Connection implements CdpClient {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private paused: CdpCallFrame[] | undefined;
  private isClosed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (e) => this.onMessage(String(e.data)));
    ws.addEventListener('close', () => this.close());
    ws.addEventListener('error', () => this.close());
  }

  /** Opens the connection of a debug session of VS Code's JavaScript debugger, or gives undefined when that fails. */
  static async open(dap: DapClient): Promise<V8Connection | undefined> {
    try {
      const proxy = await dap.request('requestCDPProxy');
      if (typeof proxy?.port !== 'number' || typeof WebSocket === 'undefined') return undefined;
      const host = String(proxy.host ?? '127.0.0.1');
      const ws = new WebSocket(`ws://${host.includes(':') ? `[${host}]` : host}:${proxy.port}${proxy.path ?? ''}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
        ws.addEventListener('open', () => (clearTimeout(timer), resolve()), { once: true });
        ws.addEventListener('error', () => (clearTimeout(timer), reject(new Error('no connection'))), { once: true });
      });
      return new V8Connection(ws);
    } catch {
      return undefined;
    }
  }

  get closed(): boolean {
    return this.isClosed;
  }

  send(method: string, params: object = {}): Promise<any> {
    if (this.isClosed) return Promise.reject(new Error('the connection to V8 is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer from V8 to ${method}`));
      }, TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * The call frames of the current pause. The debugger keeps the last event `Debugger.paused` until the program runs
   * again, and sends it again to a client that sends `Debugger.enable`, before the answer. For V8, the debugger is
   * already enabled, so the request changes nothing there.
   */
  async callFrames(): Promise<CdpCallFrame[]> {
    this.paused = undefined;
    await this.send('Debugger.enable');
    return this.paused ?? [];
  }

  dispose(): void {
    this.close();
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }

  private onMessage(text: string): void {
    let m: any;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof m.id === 'number' && m.id > 0) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(String(m.error.message ?? 'error')));
      else p.resolve(m.result);
    } else if (m.method === 'Debugger.paused') {
      this.paused = m.params?.callFrames ?? [];
    }
  }

  private close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const p of this.pending.values()) p.reject(new Error('the connection to V8 is closed'));
    this.pending.clear();
  }
}
