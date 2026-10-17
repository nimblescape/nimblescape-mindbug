// A small stand-in for VS Code's JavaScript debugger (js-debug): it answers the four
// Debug Adapter Protocol requests that the collector uses, from a paused V8 inspector.
// Scope names follow js-debug ("Local: fn", "Block", "Closure (fn)", "Module", "Global").

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
 * front of the function name of a method: the VS Code test showed "Person.birthday". The snapshot
 * (frameLabel in src/snapshot.ts) turns the names into the names of the memory view.
 */
function frameLabel(cf: PausedEvent['callFrames'][number]): string {
  const fn = cf.functionName || '<anonymous>';
  const cls = cf.this?.type === 'object' ? cf.this.className : undefined;
  if (!cf.functionName || !cls || ['Object', 'Function', 'global', 'Window'].includes(cls)) return fn;
  if (fn === cls || fn.includes('.')) return fn;
  return `${cls}.${fn}`;
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
        const res = await this.inspector.send('Debugger.evaluateOnCallFrame', {
          callFrameId: cf.callFrameId,
          expression: args.expression,
        });
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
        }
        const r = res.result;
        if (r.type === 'string') {
          // js-debug returns strings without quotes for the "clipboard" context.
          return { result: args.context === 'clipboard' ? r.value : JSON.stringify(r.value) };
        }
        return { result: r.description ?? String(r.value) };
      }
      default:
        throw new Error(`unsupported request ${command}`);
    }
  }
}
