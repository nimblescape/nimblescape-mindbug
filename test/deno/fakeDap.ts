// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// A small stand-in for VS Code's JavaScript debugger (js-debug): it answers the four
// Debug Adapter Protocol requests that the collector uses, from a paused V8 inspector.
// Scope names follow js-debug ("Local: fn", "Block", "Closure (fn)", "Module", "Global"), and the results of
// `evaluate` follow js-debug 1.140 (see `evaluate` below).

import { fileURLToPath } from 'node:url';
import type { DapClient } from '../../src/snapshot.ts';
import type { DenoInspector, PausedEvent } from './inspector.ts';

const SCOPE_NAMES: Record<string, string> = {
  local: 'Local',
  block: 'Block',
  closure: 'Closure',
  catch: 'Catch Block',
  module: 'Module',
  script: 'Script',
  global: 'Global',
  with: 'With Block',
  eval: 'Eval',
};

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

/**
 * The text of a string result as js-debug gives it without a context: at most 100,000 characters, with "…" in the
 * middle of a longer string, in the quotes that the string does not hold.
 */
function jsDebugString(value: string): string {
  const budget = 1e5 - 2;
  let s = value;
  if (s.length > budget) {
    let head = budget >> 1;
    let tail = budget - head - 1;
    const atTail = s.codePointAt(s.length - tail - 1);
    if (atTail && atTail >= 0x10000) {
      tail--;
      head++;
    }
    const atHead = s.codePointAt(head - 1);
    if (head > 0 && atHead && atHead >= 0x10000) head--;
    s = s.slice(0, head) + '…' + s.slice(s.length - tail);
  }
  const q = s.includes("'") ? (s.includes('"') ? (s.includes('`') ? "'" : '`') : '"') : "'";
  return q + s.replace(new RegExp(`[${q}\\\\]`, 'g'), '\\$&') + q;
}

/**
 * The expression that js-debug evaluates for the context "clipboard": it puts the text into a function of its own,
 * whose variables t, e, r, n, i and o hide the variables of the program, and turns the value into text.
 */
function clipboardExpression(expression: string): string {
  return (
    `(()=>{let t=${expression};let e=2;let r=" ".repeat(e),n="\\n";function i(s){return undefined}` +
    'function o(s){return typeof s==="string"?JSON.stringify(s):String(s)}try{return o(t)}catch{return""+t}})();'
  );
}

/**
 * Answers the requests of the collector in rounds, as a remote window does: the requests that the collector sends
 * before it waits for an answer form one round, and their answers come back together. `rounds` counts the rounds.
 */
export class RoundCounter implements DapClient {
  rounds = 0;
  private queue: { command: string; args?: object; resolve: (v: any) => void; reject: (e: unknown) => void }[] = [];
  private readonly dap: DapClient;

  constructor(dap: DapClient) {
    this.dap = dap;
  }

  request(command: string, args?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.queue.length === 0) setTimeout(() => void this.answer(), 0);
      this.queue.push({ command, args, resolve, reject });
    });
  }

  private async answer(): Promise<void> {
    const round = this.queue.splice(0);
    this.rounds++;
    const results = await Promise.allSettled(round.map((r) => this.dap.request(r.command, r.args)));
    results.forEach((res, i) => (res.status === 'fulfilled' ? round[i].resolve(res.value) : round[i].reject(res.reason)));
  }
}

export class FakeDap implements DapClient {
  private readonly refs = new Map<number, { objectId: string; thisObject?: { type: string } }>();
  private nextRef = 1;
  /** Every request that was sent, for assertions. */
  readonly log: { command: string; args: any }[] = [];

  private readonly inspector: DenoInspector;
  private readonly paused: PausedEvent;

  constructor(inspector: DenoInspector, paused: PausedEvent) {
    this.inspector = inspector;
    this.paused = paused;
  }

  async request(command: string, args: any = {}): Promise<any> {
    this.log.push({ command, args });
    switch (command) {
      case 'stackTrace':
        return {
          stackFrames: this.paused.callFrames.map((cf, i) => ({
            id: i,
            name: frameLabel(cf),
            line: this.inspector.originalLine(cf.location),
            column: cf.location.columnNumber + 1,
            source: cf.url.startsWith('file:') ? { name: cf.url, path: fileURLToPath(cf.url) } : { name: cf.url },
          })),
        };
      case 'scopes': {
        const cf = this.paused.callFrames[args.frameId];
        return {
          scopes: cf.scopeChain.map((s) => {
            const ref = this.nextRef++;
            this.refs.set(ref, { objectId: s.object.objectId!, thisObject: s.type === 'local' ? cf.this : undefined });
            let name = SCOPE_NAMES[s.type] ?? s.type;
            if (s.name && s.type === 'closure') name = `Closure (${s.name})`;
            else if (s.name) name = `${name}: ${s.name}`;
            return { name, variablesReference: ref, expensive: s.type === 'global' };
          }),
        };
      }
      case 'variables': {
        const entry = this.refs.get(args.variablesReference);
        if (!entry) throw new Error('unknown variablesReference');
        const res = await this.inspector.send('Runtime.getProperties', {
          objectId: entry.objectId,
          ownProperties: true,
        });
        const vars = (res.result as any[]).map((p) => ({
          name: p.name,
          value: p.value?.description ?? String(p.value?.value ?? 'undefined'),
          variablesReference: 0,
        }));
        if (entry.thisObject && entry.thisObject.type !== 'undefined') {
          vars.unshift({ name: 'this', value: 'this', variablesReference: 0 });
        }
        return { variables: vars };
      }
      case 'evaluate': {
        const cf = this.paused.callFrames[args.frameId];
        const clipboard = args.context === 'clipboard';
        const res = await this.inspector.send('Debugger.evaluateOnCallFrame', {
          callFrameId: cf.callFrameId,
          expression: clipboard ? clipboardExpression(args.expression) : args.expression,
        });
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
        }
        const r = res.result;
        if (r.type === 'string') {
          // For the context "clipboard", the text of the value comes as it is, without a limit.
          return { result: clipboard ? r.value : jsDebugString(r.value) };
        }
        return { result: r.description ?? String(r.value) };
      }
      default:
        throw new Error(`unsupported request ${command}`);
    }
  }
}
