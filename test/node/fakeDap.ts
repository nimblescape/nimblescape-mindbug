// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A small stand-in for VS Code's JavaScript debugger (js-debug), from a paused V8 inspector: it answers the Debug
// Adapter Protocol request stackTrace, which is the only DAP request of the collector, and gives the connection to
// V8, which js-debug gives with its CDP proxy (src/v8Connection.ts).

import { fileURLToPath } from 'node:url';
import type { DapClient } from '../../src/snapshot.ts';
import type { CdpClient } from '../../src/v8Connection.ts';
import type { NodeInspector, PausedEvent } from './inspector.ts';

/**
 * The name that VS Code's JavaScript debugger shows for a frame. It writes the class of `this` in
 * front of the function name of a method, and names a constructor "Person.constructor": the VS Code
 * test showed these names. The snapshot (frameLabel in src/snapshot.ts) turns the names into the
 * names of the memory view.
 */
function frameLabel(cf: PausedEvent['callFrames'][number]): string {
  const fn = cf.functionName || '<anonymous>';
  const cls = cf.this?.type === 'object' ? cf.this.className : undefined;
  if (!cf.functionName || !cls || ['Object', 'Function', 'global', 'Window'].includes(cls)) return fn;
  if (fn === cls) return `${fn}.constructor`;
  if (fn.includes('.')) return fn;
  return `${cls}.${fn}`;
}

export class FakeDap implements DapClient {
  /** Every request that was sent, for assertions. */
  readonly log: { command: string; args: object }[] = [];

  private readonly inspector: NodeInspector;
  private readonly paused: PausedEvent;

  constructor(inspector: NodeInspector, paused: PausedEvent) {
    this.inspector = inspector;
    this.paused = paused;
  }

  async request(command: string, args: object = {}): Promise<unknown> {
    this.log.push({ command, args });
    if (command !== 'stackTrace') throw new Error(`unsupported request ${command}`);
    return {
      stackFrames: this.paused.callFrames.map((cf, i) => ({
        id: i,
        name: frameLabel(cf),
        line: this.inspector.originalLine(cf.location),
        column: cf.location.columnNumber + 1,
        source: cf.url.startsWith('file:') ? { name: cf.url, path: fileURLToPath(cf.url) } : { name: cf.url },
      })),
    };
  }
}

/** The connection to V8 at a pause, as the CDP proxy of js-debug gives it. */
export function inspectorV8(inspector: NodeInspector, paused: PausedEvent): CdpClient {
  return {
    callFrames: () => Promise.resolve(paused.callFrames),
    send: (method, params) => inspector.send(method, params),
  };
}

/**
 * Answers the requests of the collector in rounds, as the requests of a step go out: the requests that the collector
 * sends before it waits for an answer form one round, and their answers come back together. `rounds` counts the
 * rounds, of the requests to the debugger and to V8 together.
 */
export class RoundCounter {
  rounds = 0;
  readonly dap: DapClient;
  readonly v8: CdpClient;
  private queue: { run: () => Promise<unknown>; settle: (result: PromiseSettledResult<unknown>) => void }[] = [];

  constructor(dap: DapClient, v8: CdpClient) {
    this.dap = { request: (command, args) => this.add(() => dap.request(command, args)) };
    this.v8 = {
      callFrames: () => this.add(() => v8.callFrames()),
      send: (method, params) => this.add(() => v8.send(method, params)),
    };
  }

  private add<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.queue.length === 0) setTimeout(() => void this.answer(), 0);
      this.queue.push({ run, settle: (r) => (r.status === 'fulfilled' ? resolve(r.value as T) : reject(r.reason)) });
    });
  }

  private async answer(): Promise<void> {
    const round = this.queue.splice(0);
    this.rounds++;
    const results = await Promise.allSettled(round.map((r) => r.run()));
    results.forEach((res, i) => round[i].settle(res));
  }
}
