// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Records the animation of the README from a real VS Code: VS Code runs examples/return-object.ts with the Mindbug
// package, and the driver (driver.ts) steps through it, goes back through the step history, and takes a screenshot of
// the screen after each action. Each screenshot gets the captions of the GIF of nimblescape-plantuml: a blue band
// above the window with the scene, and a label with the key that the user pressed.
//
//   xvfb-run -a -s "-screen 0 1440x900x24" npm run gif
//
// Linux only: it needs Xvfb (or another X display), ffmpeg with x11grab and drawtext, the font Inter (fc-match finds
// it; Debian and Ubuntu: fonts-inter), and Deno or Node.js 22.7 or newer on the PATH. It builds the package (npm run package), packs the driver as a second extension, downloads VS Code to
// .vscode-test/, installs both extensions into a new profile in test/gif/output/, and writes
// test/gif/output/return-object.gif. Copy it to docs/images/ after a check.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'output');
const frames = join(out, 'frames');
const driver = join(out, 'driver');
const userData = join(out, 'user-data');
const extensions = join(out, 'extensions');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/**
 * Seconds that the GIF shows each screenshot: the editor before the start, each step, and the last step. They follow the
 * GIF of the README of nimblescape-markdown-comment-links, which shows its first state for about 2 s, each next state
 * for about 1.6 s, and its last state for about 3 s. Each value is a multiple of 0.04 s, the time step of ffmpeg for
 * images: 1.5 s would give 1.52 s and 1.48 s in turn.
 */
const FIRST_SECONDS = 2;
const STEP_SECONDS = 1.6;
const LAST_SECONDS = 3;

/**
 * VS Code in the dark theme, with nothing that is not about the program: no activity bar (it gives its width to the
 * view), no minimap, no chat, no hints.
 */
const SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.activityBar.location': 'hidden',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'window.newWindowDimensions': 'maximized',
  'chat.disableAIFeatures': true,
  'editor.minimap.enabled': false,
  'editor.cursorBlinking': 'solid',
  'editor.lightbulb.enabled': 'off',
  'editor.occurrencesHighlight': 'off',
  'debug.toolBarLocation': 'commandCenter',
  'debug.openDebug': 'neverOpen',
  'debug.internalConsoleOptions': 'neverOpen',
  'git.enabled': false,
  'extensions.ignoreRecommendations': true,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
};

function run(command: string, args: string[], cwd = root): void {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

/** Packs driver.ts as an extension that needs the Mindbug extension. */
async function packDriver(vsix: string): Promise<void> {
  await esbuild.build({
    entryPoints: [join(here, 'driver.ts')],
    outfile: join(driver, 'extension.js'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2022',
    external: ['vscode'],
    logLevel: 'warning',
  });
  const driverManifest = {
    name: 'nimblescape-mindbug-gif',
    displayName: 'Mindbug GIF recorder',
    description: 'Steps through an example with Mindbug and takes screenshots (test/gif/driver.ts).',
    publisher: manifest.publisher,
    version: '0.0.0',
    license: 'MIT',
    engines: { vscode: manifest.engines.vscode },
    main: './extension.js',
    activationEvents: ['onStartupFinished'],
    extensionDependencies: [`${manifest.publisher}.${manifest.name}`],
  };
  writeFileSync(join(driver, 'package.json'), JSON.stringify(driverManifest, null, 2));
  writeFileSync(join(driver, 'README.md'), `# ${driverManifest.displayName}\n\n${driverManifest.description}\n`);
  run(join(root, 'node_modules', '.bin', 'vsce'), ['package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '--out', vsix], driver);
}

/** Starts VS Code with the examples folder and waits until the driver closes it. */
function startVSCode(executable: string): Promise<void> {
  const args = [
    join(root, 'examples'),
    `--user-data-dir=${userData}`,
    `--extensions-dir=${extensions}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-updates',
    '--no-sandbox',
    '--disable-gpu-sandbox',
  ];
  const child = spawn(executable, args, { env: { ...process.env, MINDBUG_GIF_FRAMES: frames }, stdio: 'ignore' });
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('VS Code did not close within 5 minutes'));
    }, 300_000);
    child.on('error', reject);
    child.on('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

/**
 * The captions, in the style of the GIF of the README of nimblescape-plantuml (docs/images/demo.gif): a band in the
 * blue of VS Code above the window, with the number and the caption of the scene in white Inter SemiBold in the middle,
 * and after a key press a label with the key and its command in white Inter on a dark box. That GIF is 1200 pixels
 * wide and this one 1440, so the sizes in pixels are 1.2 times its sizes. The label is under the code, in the middle of
 * the editor (0.4 of the width, see driver.ts), so that it covers nothing of the view.
 */
const BAND = { height: 53, baseline: 33, fontSize: 23, color: '0x0078d4' };
const LABEL = { fontSize: 26, paddingY: 9, paddingX: 16, bottom: 48, center: 0.2 };

/** The file of the font Inter in a style, from the font configuration of the system. */
function inter(style: string): string {
  const pattern = `Inter:style=${style}`;
  const [family, found, file] = execFileSync('fc-match', ['-f', '%{family[0]}|%{style[0]}|%{file}', pattern], { encoding: 'utf8' }).split('|');
  if (family !== 'Inter' || found !== style) throw new Error(`the captions need the font ${pattern} (Debian and Ubuntu: fonts-inter)`);
  return file;
}

/**
 * Adds the captions of a screenshot (the files .band.txt and .key.txt that the driver writes next to it). The
 * screenshot of VS Code itself stays as it is: the band goes above it.
 */
function caption(shot: string, captioned: string, fonts: { band: string; label: string }): void {
  const base = join(frames, shot.replace(/\.png$/, ''));
  const filters = [
    `pad=iw:ih+${BAND.height}:0:${BAND.height}:color=${BAND.color}`,
    `drawtext=fontfile='${fonts.band}':textfile='${base}.band.txt':expansion=none:fontsize=${BAND.fontSize}:fontcolor=white` +
      `:x=(w-text_w)/2:y_align=baseline:y=${BAND.baseline}`,
  ];
  if (existsSync(`${base}.key.txt`)) {
    filters.push(
      `drawtext=fontfile='${fonts.label}':textfile='${base}.key.txt':expansion=none:fontsize=${LABEL.fontSize}:fontcolor=white` +
        `:box=1:boxcolor=black@0.85:boxborderw=${LABEL.paddingY}|${LABEL.paddingX}` +
        `:x=w*${LABEL.center}-text_w/2:y_align=font:y=h-${LABEL.bottom}-${LABEL.paddingY}-text_h`,
    );
  }
  run('ffmpeg', ['-loglevel', 'error', '-i', join(frames, shot), '-vf', filters.join(','), '-y', captioned]);
}

/** Joins the captioned screenshots to a GIF that repeats, with one GIF frame for each screenshot. */
function makeGif(gif: string, fonts: { band: string; label: string }): void {
  const shots = readdirSync(frames).filter((f) => f.endsWith('.png')).sort();
  const captioned = join(out, 'captioned');
  mkdirSync(captioned, { recursive: true });
  for (const shot of shots) caption(shot, join(captioned, shot), fonts);
  const lines = shots.flatMap((shot, i) => [`file '${join(captioned, shot)}'`, `duration ${i === 0 ? FIRST_SECONDS : STEP_SECONDS}`]);
  const list = join(out, 'frames.txt');
  writeFileSync(list, `${lines.join('\n')}\n`);
  run('ffmpeg', [
    '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    // One palette of 256 colors for all frames, without dithering: the text stays sharp.
    '-vf', 'split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none',
    '-fps_mode', 'vfr',
    '-loop', '0',
    // The concat demuxer drops the duration of the last file; the GIF muxer sets it (in 1/100 s).
    '-final_delay', String(LAST_SECONDS * 100),
    '-y', gif,
  ]);
}

// Before the recording: the captions need the font.
const fonts = { band: inter('SemiBold'), label: inter('Regular') };
rmSync(out, { recursive: true, force: true });
for (const dir of [frames, driver, join(userData, 'User'), extensions]) mkdirSync(dir, { recursive: true });
writeFileSync(join(userData, 'User', 'settings.json'), JSON.stringify(SETTINGS, null, 2));

const mindbugVsix = join(out, `${manifest.name}.vsix`);
const driverVsix = join(out, 'driver.vsix');
run('npm', ['run', 'package', '--', '--out', mindbugVsix]);
await packDriver(driverVsix);

const executable = await downloadAndUnzipVSCode({ version: process.env.VSCODE_TEST_VERSION || 'stable', cachePath: join(root, '.vscode-test') });
run(resolveCliPathFromVSCodeExecutablePath(executable), [
  `--user-data-dir=${userData}`,
  `--extensions-dir=${extensions}`,
  '--install-extension', mindbugVsix,
  '--install-extension', driverVsix,
]);

await startVSCode(executable);
if (!existsSync(join(frames, 'done'))) {
  const error = join(frames, 'error.txt');
  throw new Error(`the recording failed: ${existsSync(error) ? readFileSync(error, 'utf8') : 'VS Code closed before the end'}`);
}
const gif = join(out, 'return-object.gif');
makeGif(gif, fonts);
console.log(`Wrote ${gif}`);
