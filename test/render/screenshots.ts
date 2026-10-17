// Screenshot test of the memory panel. It loads the real panel page (the same HTML, CSS and script
// as in VS Code) in Chromium, sends it the snapshots that record.ts recorded from the examples,
// and saves screenshots in the light, dark and high contrast themes.
//
//   npm run test:render        (writes test/render/output/*.png)
//
// It also checks a few things that must be true in every theme: the page has no script errors,
// every arrow has a target, and the step history works.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';
import { webviewHtml } from '../../src/webviewHtml.ts';
import type { MemorySnapshot, ToWebview } from '../../src/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'output');

/** Colors that VS Code gives a webview, for its default themes ("Light Modern", "Dark Modern", "Dark High Contrast"). */
const THEMES = {
  light: {
    bodyClass: 'vscode-light',
    vars: {
      '--vscode-editor-background': '#ffffff',
      '--vscode-editor-foreground': '#3b3b3b',
      '--vscode-panel-border': '#e5e5e5',
      '--vscode-focusBorder': '#005fb8',
      '--vscode-button-secondaryBackground': '#e5e5e5',
      '--vscode-button-secondaryForeground': '#3b3b3b',
    },
  },
  dark: {
    bodyClass: 'vscode-dark',
    vars: {
      '--vscode-editor-background': '#1f1f1f',
      '--vscode-editor-foreground': '#cccccc',
      '--vscode-panel-border': '#2b2b2b',
      '--vscode-focusBorder': '#0078d4',
      '--vscode-button-secondaryBackground': '#313131',
      '--vscode-button-secondaryForeground': '#cccccc',
    },
  },
  'high-contrast': {
    bodyClass: 'vscode-high-contrast',
    vars: {
      '--vscode-editor-background': '#000000',
      '--vscode-editor-foreground': '#ffffff',
      '--vscode-panel-border': '#6fc3df',
      '--vscode-focusBorder': '#f38518',
      '--vscode-contrastBorder': '#6fc3df',
      '--vscode-button-secondaryBackground': '#000000',
      '--vscode-button-secondaryForeground': '#ffffff',
    },
  },
} as const;

type ThemeName = keyof typeof THEMES;

/** Chromium to use: CHROMIUM_PATH, a browser that is already installed for Playwright, or Playwright's default. */
function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir || !existsSync(dir)) return undefined;
  for (const name of readdirSync(dir).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const exe = join(dir, name, 'chrome-linux', 'chrome');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

function loadSteps(name: string): MemorySnapshot[] {
  return JSON.parse(readFileSync(join(here, 'snapshots', `${name}.json`), 'utf8'));
}

function writePage(): string {
  mkdirSync(out, { recursive: true });
  copyFileSync(join(root, 'dist', 'webview.js'), join(out, 'webview.js'));
  copyFileSync(join(root, 'dist', 'webview.css'), join(out, 'webview.css'));
  const nonce = 'test-nonce';
  let html = webviewHtml({ cspSource: "'self' file:", nonce, scriptUri: 'webview.js', styleUri: 'webview.css' });
  // The VS Code api does not exist in a normal browser: a stand-in records the messages.
  const stub = `<script nonce="${nonce}">
window.__sent = [];
window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__sent.push(m), getState: () => undefined, setState: () => {} });
</script>
`;
  html = html.replace(`<script nonce="${nonce}" src=`, `${stub}<script nonce="${nonce}" src=`);
  const file = join(out, 'panel.html');
  writeFileSync(file, html);
  return file;
}

async function openPanel(page: Page, file: string, theme: ThemeName): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`file://${file}`);
  const t = THEMES[theme];
  await page.evaluate(
    ({ cls, vars }) => {
      document.body.classList.add(cls);
      for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    },
    { cls: t.bodyClass, vars: t.vars as Record<string, string> },
  );
  return errors;
}

async function send(page: Page, msg: ToWebview): Promise<void> {
  await page.evaluate((m) => window.postMessage(m, '*'), msg);
  await page.waitForTimeout(80);
}

async function checkArrows(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const ptrs = [...document.querySelectorAll<HTMLElement>('.ptr[data-target]')];
    const missing = ptrs.filter((p) => !document.querySelector(`.obj[data-id="${p.dataset.target}"]`)).length;
    return { ptrs: ptrs.length, paths: document.querySelectorAll('#arrows path.arrow').length, missing };
  });
  if (result.missing > 0 || result.paths !== result.ptrs) {
    throw new Error(`${label}: ${result.ptrs} pointers, ${result.paths} arrows, ${result.missing} without target`);
  }
}

function lastIndex(steps: MemorySnapshot[], test: (s: MemorySnapshot) => boolean): number {
  for (let i = steps.length - 1; i >= 0; i--) if (test(steps[i])) return i;
  return steps.length - 1;
}

async function main(): Promise<void> {
  const file = writePage();
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const shots: string[] = [];
  const sort = loadSteps('insertion-sort');
  const people = loadSteps('people');
  const list = loadSteps('linked-list');
  const calls = loadSteps('call-stack');

  try {
    for (const theme of Object.keys(THEMES) as ThemeName[]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
      const errors = await openPanel(page, file, theme);
      const shot = async (name: string) => {
        const path = join(out, `${name}-${theme}.png`);
        await page.waitForTimeout(120);
        await page.screenshot({ path });
        shots.push(path);
      };

      // 1. Insertion sort, live: the program is inside insertionSort; arr and arr2 point to one array.
      const sortLive = Math.min(sort.length - 1, 40);
      await send(page, { type: 'history', snapshots: sort.slice(0, sortLive + 1), sessionId: 'sort' });
      await checkArrows(page, `sort ${theme}`);
      await shot('sort');

      // 2. Step history: go back to an earlier step with the step list.
      await page.click('#steps li:nth-child(8) button');
      const stepText = await page.textContent('#stepText');
      if (!stepText?.startsWith('Step 8 of')) throw new Error(`history step text: ${stepText}`);
      const sent = await page.evaluate(() => (window as any).__sent as any[]);
      const view = sent.filter((m) => m.type === 'viewStep').pop();
      if (!view || view.step !== 8 || view.live) throw new Error(`viewStep message: ${JSON.stringify(view)}`);
      await shot('history');

      // 3. Classes and static variables: the program is in birthday(); the mouse is over bob.
      const inBirthday = lastIndex(people, (s) => s.frames.at(-1)?.name === 'Person.birthday');
      await send(page, { type: 'history', snapshots: people.slice(0, inBirthday + 1), sessionId: 'people' });
      await checkArrows(page, `people ${theme}`);
      const classes = await page.$$eval('.class-box .class-name', (els) => els.map((e) => e.textContent));
      if (classes.join(',') !== 'Address,Person,Student') throw new Error(`classes: ${classes.join(',')}`);
      const student = await page.$('.obj[data-cls]:not(.class-box) .uml-name >> text=:Student');
      if (!student) throw new Error('no :Student object');
      await student.hover();
      const links = await page.$$eval('#arrowsTop g.links path', (els) => els.length);
      if (links !== 1) throw new Error(`class links on hover: ${links}`);
      await shot('classes');
      await page.mouse.move(2, 2);

      // 4. Linked list at the end of the program.
      const listEnd = lastIndex(list, (s) => s.frames.length === 1);
      await send(page, { type: 'history', snapshots: list.slice(0, listEnd + 1), sessionId: 'list' });
      await checkArrows(page, `list ${theme}`);
      await shot('linked-list');

      // 5. Call stack: the program is in lineTotal, so four scopes are on the stack. The variables of each scope
      //    build bottom up: cart, the first variable of the Global scope, is at the bottom.
      const inLineTotal = lastIndex(calls, (s) => s.frames.at(-1)?.name === 'lineTotal');
      // Four scopes need a taller panel.
      await page.setViewportSize({ width: 1100, height: 1060 });
      await send(page, { type: 'history', snapshots: calls.slice(0, inLineTotal + 1), sessionId: 'calls' });
      await checkArrows(page, `calls ${theme}`);
      const scopes = await page.$$eval('.frame .frame-name', (els) => els.map((e) => e.textContent));
      if (scopes.join(',') !== 'lineTotal,makeBill,checkout,Global scope') throw new Error(`scopes: ${scopes.join(',')}`);
      const globals = await page.$$eval('.frame:last-child .var-name', (els) => els.map((e) => e.textContent));
      if (globals.join(',') !== 'bill,cart') throw new Error(`variables of the Global scope: ${globals.join(',')}`);
      await shot('call-stack');

      if (errors.length > 0) throw new Error(`page errors in ${theme}:\n${errors.join('\n')}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`ok: ${shots.length} screenshots in ${out}`);
}

await main();
