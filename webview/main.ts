// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Entry point of the webview: receives snapshots from the extension, keeps the step history,
// and draws the stack, the heap and the arrows.

import type { FromWebview, MemorySnapshot, ProgramState, ToWebview } from '../src/model.ts';
import { computeChanges } from '../src/changes.ts';
import { clearClassLinks, drawArrows, highlightArrows, showClassLinks } from './arrows.ts';
import { StepHistory, stepLineText, stepTitle, topFrame, whereText } from './history.ts';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from './layout.ts';
import { renderFrames, renderHeap } from './render.ts';

interface VsCodeApi {
  postMessage(msg: FromWebview): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** The switches of the settings, which the extension writes into the page (attribute `data-view-options`). */
function initialOptions(): Partial<ViewOptions> {
  try {
    return JSON.parse(document.body.dataset.viewOptions ?? '{}') as Partial<ViewOptions>;
  } catch {
    return {};
  }
}

const vscode = acquireVsCodeApi();

const history = new StepHistory(Number(document.body.dataset.maxSteps) || undefined);
const state = {
  opts: { ...DEFAULT_VIEW_OPTIONS, ...initialOptions() } as ViewOptions,
  focusFrameId: undefined as number | undefined,
  programState: 'idle' as ProgramState,
  statusText: '',
  /** Number of steps when the step list was built; the list is rebuilt only when it changes. */
  stepsBuiltFor: '',
  /** Last step reported to the extension, to send `viewStep` only when it changes. */
  reportedView: '',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLElement>('canvas');
const svg = document.getElementById('arrows') as unknown as SVGSVGElement;
const topSvg = document.getElementById('arrowsTop') as unknown as SVGSVGElement;
const framesEl = $<HTMLElement>('frames');
const heapEl = $<HTMLElement>('heap');
const statusEl = $<HTMLElement>('status');
const emptyEl = $<HTMLElement>('empty');
const legendEl = $<HTMLElement>('legend');
const historyEl = $<HTMLElement>('history');
const slider = $<HTMLInputElement>('slider');
const stepText = $<HTMLElement>('stepText');
const stepsEl = $<HTMLOListElement>('steps');
const prevBtn = $<HTMLButtonElement>('prev');
const nextBtn = $<HTMLButtonElement>('next');
const liveBtn = $<HTMLButtonElement>('live');
const showFunctions = $<HTMLInputElement>('showFunctions');
const showIds = $<HTMLInputElement>('showIds');
const showClasses = $<HTMLInputElement>('showClasses');
const showUninitialized = $<HTMLInputElement>('showUninitialized');
const showScopeFrames = $<HTMLInputElement>('showScopeFrames');
const stopOnEntry = $<HTMLInputElement>('stopOnEntry');

function showOptions(): void {
  showFunctions.checked = state.opts.showFunctions;
  showIds.checked = state.opts.showIds;
  showClasses.checked = state.opts.showClasses;
  showUninitialized.checked = state.opts.showUninitialized;
  showScopeFrames.checked = state.opts.showScopeFrames;
  stopOnEntry.checked = state.opts.stopOnEntry;
}
showOptions();

/** A click on a switch: the extension saves that switch in the settings, so that the view has it again. */
function saveOption(name: keyof ViewOptions): void {
  vscode.postMessage({ type: 'viewOption', name, value: state.opts[name] });
}

function statusLine(): string {
  const newest = history.newest();
  if (state.programState === 'running') return 'The program is running…';
  if (state.programState === 'ended') return 'The program has ended.';
  if (state.programState === 'error') return state.statusText;
  if (!newest) return state.statusText || 'No program is paused.';
  const where = whereText(newest);
  const text = where ? `Paused at ${where}` : 'Paused';
  return newest.fallback ? `${text} (simple view: the heap could not be read)` : text;
}

/** Builds the list of steps (one button for each step). */
function buildSteps(): void {
  const key = `${history.sessionId}:${history.length}:${history.snapshots[0]?.step ?? 0}`;
  if (key === state.stepsBuiltFor) return;
  state.stepsBuiltFor = key;
  stepsEl.replaceChildren();
  history.snapshots.forEach((snap, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'step';
    b.dataset.index = String(i);
    b.title = stepTitle(snap);
    const n = document.createElement('span');
    n.className = 'step-n';
    n.textContent = String(snap.step);
    const l = document.createElement('span');
    l.className = 'step-l';
    l.textContent = stepLineText(snap);
    b.append(n, l);
    li.append(b);
    stepsEl.append(li);
  });
}

function updateSteps(): void {
  buildSteps();
  const last = history.length - 1;
  for (const b of stepsEl.querySelectorAll<HTMLButtonElement>('button.step')) {
    const i = Number(b.dataset.index);
    const selected = i === history.view;
    b.classList.toggle('selected', selected);
    b.classList.toggle('now', i === last);
    b.setAttribute('aria-current', selected ? 'step' : 'false');
    const n = b.querySelector('.step-n')!;
    const label = String(history.snapshots[i]?.step ?? '');
    n.textContent = i === last && state.programState !== 'ended' ? `${label} now` : label;
  }
  const sel = stepsEl.querySelector<HTMLElement>('button.step.selected');
  sel?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function reportView(): void {
  const snap = history.current();
  if (!snap) return;
  const live = history.isLive();
  const key = `${history.sessionId}:${snap.step}:${live}`;
  if (key === state.reportedView) return;
  state.reportedView = key;
  const top = topFrame(snap);
  vscode.postMessage({ type: 'viewStep', step: snap.step, live, file: top?.file, line: top?.line });
}

function render(): void {
  const snap = history.current();
  const live = history.isLive();
  document.body.classList.toggle('running', state.programState === 'running' && live);
  document.body.classList.toggle('ended', state.programState === 'ended');
  document.body.classList.toggle('past', !live);
  statusEl.textContent = statusLine();

  const count = history.length;
  historyEl.hidden = count === 0;
  slider.max = String(Math.max(1, count));
  slider.value = String(history.view + 1);
  slider.disabled = count < 2;
  prevBtn.disabled = history.view <= 0;
  nextBtn.disabled = history.view >= count - 1;
  const shown = snap?.step ?? 0;
  const newest = history.newest()?.step ?? 0;
  stepText.textContent = count > 0 ? `Step ${shown} of ${newest}` : '';
  liveBtn.hidden = count === 0 || live;
  updateSteps();

  if (!snap) {
    emptyEl.hidden = false;
    canvas.hidden = true;
    legendEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  canvas.hidden = false;
  legendEl.hidden = false;

  const input = {
    snap,
    changes: computeChanges(history.previous(), snap),
    opts: state.opts,
    focusFrameId: live ? state.focusFrameId : undefined,
    live,
  };
  renderFrames(framesEl, input);
  renderHeap(heapEl, input);
  hovered = null;
  document.body.classList.toggle('has-classes', heapEl.querySelector('.class-box') !== null);
  scheduleArrows();
  reportView();
}

let arrowFrame = 0;
function scheduleArrows(): void {
  cancelAnimationFrame(arrowFrame);
  arrowFrame = requestAnimationFrame(() => drawArrows(canvas, svg, topSvg));
}

function showStep(index: number): void {
  if (history.show(index)) render();
}

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'snapshot':
      history.add(msg.snapshot, msg.sessionId);
      state.programState = 'paused';
      render();
      break;
    case 'history':
      history.replace(msg.snapshots, msg.sessionId);
      state.programState = msg.snapshots.length > 0 ? 'paused' : 'idle';
      // A text of the earlier run, for example an error, does not describe the new history.
      state.statusText = '';
      render();
      break;
    case 'status':
      state.programState = msg.state;
      state.statusText = msg.text;
      render();
      break;
    case 'showStep': {
      const i = history.snapshots.findIndex((s) => s.step === msg.step);
      if (i >= 0) showStep(i);
      break;
    }
    case 'viewOptions': {
      const opts = { ...DEFAULT_VIEW_OPTIONS, ...msg.opts };
      if ((Object.keys(DEFAULT_VIEW_OPTIONS) as (keyof ViewOptions)[]).every((k) => opts[k] === state.opts[k])) break;
      state.opts = opts;
      showOptions();
      render();
      break;
    }
    case 'focusFrame':
      state.focusFrameId = msg.frameId;
      for (const f of framesEl.querySelectorAll<HTMLElement>('.frame')) {
        const focused = history.isLive() && !f.classList.contains('active') && f.dataset.frameId === String(msg.frameId);
        f.classList.toggle('focused', focused);
      }
      break;
  }
});

prevBtn.addEventListener('click', () => showStep(history.view - 1));
nextBtn.addEventListener('click', () => showStep(history.view + 1));
liveBtn.addEventListener('click', () => showStep(history.length - 1));
slider.addEventListener('input', () => showStep(Number(slider.value) - 1));
stepsEl.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('button.step');
  if (b) showStep(Number(b.dataset.index));
});
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const keys: Record<string, () => number> = {
    ArrowLeft: () => history.view - 1,
    ArrowRight: () => history.view + 1,
    Home: () => 0,
    End: () => history.length - 1,
  };
  const target = keys[e.key];
  if (!target) return;
  showStep(target());
  e.preventDefault();
});

showFunctions.addEventListener('change', () => {
  state.opts = { ...state.opts, showFunctions: showFunctions.checked };
  saveOption('showFunctions');
  render();
});
showIds.addEventListener('change', () => {
  state.opts = { ...state.opts, showIds: showIds.checked };
  saveOption('showIds');
  render();
});
showClasses.addEventListener('change', () => {
  state.opts = { ...state.opts, showClasses: showClasses.checked };
  saveOption('showClasses');
  render();
});
showUninitialized.addEventListener('change', () => {
  state.opts = { ...state.opts, showUninitialized: showUninitialized.checked };
  saveOption('showUninitialized');
  render();
});
showScopeFrames.addEventListener('change', () => {
  state.opts = { ...state.opts, showScopeFrames: showScopeFrames.checked };
  saveOption('showScopeFrames');
  render();
});
// The switch changes the next start of a program, not the view.
stopOnEntry.addEventListener('change', () => {
  state.opts = { ...state.opts, stopOnEntry: stopOnEntry.checked };
  saveOption('stopOnEntry');
});

framesEl.addEventListener('click', (e) => {
  const title = (e.target as HTMLElement).closest<HTMLElement>('.frame-title.link');
  if (title?.dataset.file) {
    vscode.postMessage({ type: 'openLocation', file: title.dataset.file, line: Number(title.dataset.line) });
  }
});

let hovered: HTMLElement | null = null;
heapEl.addEventListener('mouseover', (e) => {
  const obj = (e.target as HTMLElement).closest<HTMLElement>('.obj');
  if (obj === hovered) return;
  hovered = obj;
  highlightArrows(svg, topSvg, obj?.dataset.id);
  if (obj) showClassLinks(canvas, topSvg, obj);
  else clearClassLinks(canvas, topSvg);
});
heapEl.addEventListener('mouseleave', () => {
  hovered = null;
  highlightArrows(svg, topSvg, undefined);
  clearClassLinks(canvas, topSvg);
});

new ResizeObserver(() => scheduleArrows()).observe(canvas);
canvas.addEventListener('scroll', () => scheduleArrows());

render();
vscode.postMessage({ type: 'ready' });
