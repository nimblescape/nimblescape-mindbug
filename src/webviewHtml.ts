// HTML of the memory panel. Kept separate from panel.ts (no 'vscode' import),
// so the screenshot tests can load exactly the same page in a browser.

export interface WebviewHtmlInput {
  /** Value for the Content-Security-Policy, for example `webview.cspSource`. */
  cspSource: string;
  nonce: string;
  scriptUri: string;
  styleUri: string;
  /** Maximum number of steps the panel keeps (setting `heapStack.maxHistorySteps`). */
  maxSteps?: number;
}

export function webviewHtml(o: WebviewHtmlInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource}; script-src 'nonce-${o.nonce}'; img-src ${o.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${o.styleUri}" rel="stylesheet">
<title>Heap Stack</title>
</head>
<body data-max-steps="${o.maxSteps ?? 500}">
<header class="toolbar">
  <div class="status" id="status" role="status">No program is paused.</div>
  <label class="toggle" title="Show the classes, with their static variables, at the top of the heap"><input type="checkbox" id="showClasses"> Show classes</label>
  <label class="toggle" title="Show functions, and the variables that hold functions or classes"><input type="checkbox" id="showFunctions"> Show functions</label>
  <label class="toggle"><input type="checkbox" id="showIds"> Show ids</label>
</header>
<nav id="history" class="history" aria-label="Step history" hidden>
  <div class="history-controls">
    <button id="prev" type="button" class="icon" title="Show the earlier step (Left arrow key)" aria-label="Earlier step">&#8249;</button>
    <input id="slider" type="range" min="1" max="1" value="1" aria-label="Step">
    <button id="next" type="button" class="icon" title="Show the later step (Right arrow key)" aria-label="Later step">&#8250;</button>
    <span id="stepText" class="step-text"></span>
    <button id="live" type="button" class="primary" title="Show the step where the program is now (End key)" hidden>Show current step</button>
  </div>
  <ol id="steps" class="steps" aria-label="Steps"></ol>
</nav>
<div id="empty" class="empty">
  <p><strong>No program is paused.</strong></p>
  <p>Open a TypeScript file and run the command <strong>Run with Heap Stack</strong>,
  or start your own Deno launch configuration with F5.</p>
  <p>When the program stops at a breakpoint or after a step, this panel shows the <strong>stack</strong>
  (one frame for each function call, with its local variables) and the <strong>heap</strong>
  (the objects and arrays that the variables point to).</p>
</div>
<main id="canvas" class="canvas" hidden>
  <svg id="arrows" class="arrows" aria-hidden="true"></svg>
  <svg id="arrowsTop" class="arrows arrows-top" aria-hidden="true"></svg>
  <div class="diagram">
    <section class="region stack-region" aria-labelledby="stackTitle">
      <h2 id="stackTitle" class="region-title">STACK</h2>
      <p class="region-sub">One frame for each function call. Local variables live here.</p>
      <div id="frames" class="frames"></div>
      <p class="hint">&#8595; A new function call adds a frame at the bottom.</p>
    </section>
    <section class="region heap-region" aria-labelledby="heapTitle">
      <h2 id="heapTitle" class="region-title">HEAP</h2>
      <p class="region-sub">Objects and arrays live here. Variables only point to them.</p>
      <div id="heap" class="heap"></div>
    </section>
  </div>
</main>
<footer id="legend" class="legend" hidden>
  <span class="legend-item">
    <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><circle class="lg-dot" cx="5" cy="6" r="4"></circle><path class="lg-line" d="M5 6H28"></path><path class="lg-dot" d="M26 2L32 6L26 10z"></path></svg>
    Reference: the variable stores where the object is, not the object itself
  </span>
  <span class="legend-item legend-classes">
    <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><path class="lg-inst" d="M2 6H28"></path><path class="lg-hot" d="M26 2L32 6L26 10z"></path></svg>
    Made from this class (mouse over an object)
  </span>
  <span class="legend-item legend-classes">
    <svg width="34" height="12" viewBox="0 0 34 12" aria-hidden="true"><path class="lg-gen" d="M2 6H22"></path><path class="lg-genhead" d="M22 1L32 6L22 11z"></path></svg>
    extends (subclass to superclass)
  </span>
  <span class="legend-item legend-classes"><span class="static">count</span>Underlined: static, one value for the whole class</span>
  <span class="legend-item"><span class="swatch changed-swatch"></span>Changed in the last step</span>
  <span class="legend-item"><span class="swatch active-swatch"></span>The function that runs now</span>
</footer>
<script nonce="${o.nonce}" src="${o.scriptUri}"></script>
</body>
</html>`;
}
