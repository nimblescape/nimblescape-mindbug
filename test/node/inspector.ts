// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A small Chrome DevTools Protocol client for the V8 inspector of Node.js, used by the tests.
// VS Code's JavaScript debugger talks the same protocol to Node.js; these tests use it directly.

import { spawn, type ChildProcess } from 'node:child_process';
import type { CdpCallFrame as V8CallFrame } from '../../src/v8Connection.ts';
import { lineMapFromUrl, originalLine, type LineMap } from './sourceMap.ts';
import { mindbugNode } from './typeScript.ts';

export interface CdpCallFrame extends V8CallFrame {
  location: { scriptId: string; lineNumber: number; columnNumber: number };
}

export interface PausedEvent {
  reason: string;
  callFrames: CdpCallFrame[];
}

export class NodeInspector {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private readonly pauses: PausedEvent[] = [];
  private pauseWaiter: ((e: PausedEvent) => void) | undefined;
  private exited = false;
  /** Script id to URL, from Debugger.scriptParsed events (CallFrame.url can be empty). */
  readonly scripts = new Map<string, string>();
  /** Script id to its source map line table (the hooks of Mindbug give inline source maps for TypeScript). */
  readonly sourceMaps = new Map<string, LineMap>();
  output = '';

  private readonly proc: ChildProcess;
  private readonly ws: WebSocket;

  private constructor(proc: ChildProcess, ws: WebSocket) {
    this.proc = proc;
    this.ws = ws;
    ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
    proc.on('exit', () => {
      this.exited = true;
    });
  }

  /**
   * Starts `node --inspect-brk` with the TypeScript file, as Mindbug starts it (mindbugNode), and connects to it. The
   * first pause (at the first line of the program) is dropped unless `keepFirstPause` is true.
   */
  static async start(file: string, port: number, keepFirstPause = false): Promise<NodeInspector> {
    const typeScript = mindbugNode();
    const proc = spawn(process.execPath, [`--inspect-brk=127.0.0.1:${port}`, ...typeScript.args, file], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...typeScript.env, NO_COLOR: '1' },
    });
    let output = '';
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Node.js did not start:\n${output}`)), 20000);
      const onData = (d: Buffer) => {
        output += d.toString();
        const m = /ws:\/\/[^\s]+/.exec(output);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      };
      proc.stderr!.on('data', onData);
      proc.stdout!.on('data', onData);
      proc.on('exit', (code) => reject(new Error(`Node.js exited with code ${code}:\n${output}`)));
    });
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('cannot connect to the inspector')));
    });
    const inspector = new NodeInspector(proc, ws);
    proc.stdout!.on('data', (d: Buffer) => (inspector.output += d.toString()));
    await inspector.send('Runtime.enable');
    await inspector.send('Debugger.enable');
    // The code of Node.js, as with "skipFiles": ["<node_internals>/**"] of the JavaScript debugger: a step does not
    // pause in it. Node.js 22 pauses first in its own code that loads an ES module.
    await inspector.send('Debugger.setBlackboxPatterns', { patterns: ['^node:'] });
    await inspector.send('Runtime.runIfWaitingForDebugger');
    // --inspect-brk stops at the first line of the program.
    const first = await inspector.waitForPause();
    if (keepFirstPause) inspector.pauses.unshift(first);
    return inspector;
  }

  private onMessage(text: string): void {
    const msg = JSON.parse(text);
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Debugger.scriptParsed') {
      this.scripts.set(msg.params.scriptId, msg.params.url);
      const mapUrl: string | undefined = msg.params.sourceMapURL;
      if (mapUrl && mapUrl.startsWith('data:')) {
        try {
          const map = lineMapFromUrl(mapUrl);
          if (map) this.sourceMaps.set(msg.params.scriptId, map);
        } catch {
          // A map that cannot be read: lines stay as they are.
        }
      }
      return;
    }
    if (msg.method === 'Debugger.paused') {
      const ev = msg.params as PausedEvent;
      for (const cf of ev.callFrames) {
        if (!cf.url) cf.url = this.scripts.get(cf.location.scriptId) ?? '';
      }
      if (this.pauseWaiter) {
        const w = this.pauseWaiter;
        this.pauseWaiter = undefined;
        w(ev);
      } else {
        this.pauses.push(ev);
      }
    }
  }

  /** 1-based line in the original (TypeScript) file for a paused location. */
  originalLine(location: { scriptId: string; lineNumber: number; columnNumber: number }): number {
    const map = this.sourceMaps.get(location.scriptId);
    const line = map ? originalLine(map, location.lineNumber, location.columnNumber) : undefined;
    return (line ?? location.lineNumber) + 1;
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  waitForPause(timeoutMs = 20000): Promise<PausedEvent> {
    const queued = this.pauses.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no pause; program output:\n${this.output}`)), timeoutMs);
      this.pauseWaiter = (e) => {
        clearTimeout(timer);
        resolve(e);
      };
    });
  }

  /** Resumes and waits for the next pause (a `debugger;` statement in the test programs). */
  async resumeToNextPause(): Promise<PausedEvent> {
    await this.send('Debugger.resume');
    return this.waitForPause();
  }

  /** One debugger step, like the Step Into / Step Over / Step Out buttons. Undefined when the program ended. */
  async step(kind: 'stepInto' | 'stepOver' | 'stepOut', timeoutMs = 5000): Promise<PausedEvent | undefined> {
    await this.send(`Debugger.${kind}`);
    try {
      return await this.waitForPause(timeoutMs);
    } catch {
      return undefined;
    }
  }

  get hasExited(): boolean {
    return this.exited;
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    if (!this.exited) this.proc.kill('SIGKILL');
  }
}
