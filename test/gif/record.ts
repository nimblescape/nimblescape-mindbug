// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Records the animation of the README from a real VS Code: VS Code runs examples/return-object.ts with the Mindbug
// package, and the driver (driver.ts) steps through it, goes back through the step history, and takes a screenshot of
// the screen after each action. Each screenshot gets the captions of the GIFs of nimblescape PlantUML and nimblescape
// Comment Links: a blue band above the window with the scene, and for a short time a label with the key that the user
// pressed.
//
//   xvfb-run -a -s "-screen 0 1440x816x24" npm run gif
//
// Linux only: it needs Xvfb (or another X display), ffmpeg with x11grab and drawtext, xdotool, the font Inter
// (fc-match finds it; Debian and Ubuntu: fonts-inter), and Deno or Node.js 22.7 or newer on the PATH. It builds the
// package (npm run package), packs the driver as a second extension, downloads VS Code to .vscode-test/, installs both
// extensions into a new profile in test/gif/output/, and writes test/gif/output/return-object.gif. Copy it to
// docs/images/ after a check.

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
 * Seconds that the GIF shows each screenshot: the editor before the start, each step with the label of its key, each
 * step after the label goes away, and the last step after its label. They follow the GIF of the README of
 * nimblescape-commentlinks, which shows its first state for about 2 s, each next state for about 1.6 s, and
 * its last state for about 3 s, and the GIF of nimblescape-plantuml, which shows each key label for about 1.6 s and
 * then removes it. Each value is a multiple of 0.04 s, the time step of ffmpeg for images: 1.5 s would give 1.52 s and
 * 1.48 s in turn.
 */
const FIRST_SECONDS = 2;
const LABEL_SECONDS = 1.6;
const AFTER_LABEL_SECONDS = 0.8;
const LAST_SECONDS = 3;

/**
 * VS Code in the dark theme at a zoom of 120 %, with nothing that is not about the program: no activity bar (it gives
 * its width to the view), no minimap, no sticky scroll, no folding marks, no chat, no hints. The window of 1440 x 816
 * pixels at 120 % has the layout of a window of 1200 x 680 pixels, as in the GIFs of nimblescape PlantUML and
 * nimblescape Comment Links.
 */
const SETTINGS = {
  'workbench.colorTheme': 'Default Dark Modern',
  'window.zoomLevel': 1,
  'workbench.activityBar.location': 'hidden',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'window.newWindowDimensions': 'maximized',
  'chat.disableAIFeatures': true,
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.folding': false,
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
 * The captions, the same as in the GIFs of nimblescape PlantUML and nimblescape Comment Links (1440 pixels wide): a
 * band of 53 pixels in the blue of VS Code above the window, with the number and the caption of the scene in white
 * Inter SemiBold 23, centered, and after a key press a label with the key and its command in white Inter 25 on a black
 * box (85 %), padding 12 | 16, its bottom 71 pixels above the bottom of the GIF, centered.
 */
const BAND = { height: 53, fontSize: 23, color: '0x0078d4' };
const LABEL = { fontSize: 25, paddingY: 12, paddingX: 16, bottom: 71 };

/** The file of the font Inter in a style, from the font configuration of the system. */
function inter(style: string): string {
  const pattern = `Inter:style=${style}`;
  const [family, found, file] = execFileSync('fc-match', ['-f', '%{family[0]}|%{style[0]}|%{file}', pattern], { encoding: 'utf8' }).split('|');
  if (family !== 'Inter' || found !== style) throw new Error(`the captions need the font ${pattern} (Debian and Ubuntu: fonts-inter)`);
  return file;
}

/**
 * Adds the captions of a screenshot (the files .band.txt and .key.txt that the driver writes next to it): the band,
 * and the label of the key if `label` is true. The screenshot of VS Code itself stays as it is: the band goes above it.
 */
function caption(shot: string, captioned: string, fonts: { band: string; label: string }, label: boolean): void {
  const base = join(frames, shot.replace(/\.png$/, ''));
  const filters = [
    `pad=iw:ih+${BAND.height}:0:${BAND.height}:color=${BAND.color}`,
    `drawtext=fontfile='${fonts.band}':textfile='${base}.band.txt':expansion=none:fontsize=${BAND.fontSize}:fontcolor=white` +
      `:x=(w-text_w)/2:y=(${BAND.height}-text_h)/2`,
  ];
  if (label) {
    filters.push(
      `drawtext=fontfile='${fonts.label}':textfile='${base}.key.txt':expansion=none:fontsize=${LABEL.fontSize}:fontcolor=white` +
        `:box=1:boxcolor=black@0.85:boxborderw=${LABEL.paddingY}|${LABEL.paddingX}` +
        `:x=(w-text_w)/2:y_align=font:y=h-${LABEL.bottom}-${LABEL.paddingY}-text_h`,
    );
  }
  run('ffmpeg', ['-loglevel', 'error', '-i', join(frames, shot), '-vf', filters.join(','), '-y', captioned]);
}

/**
 * Joins the captioned screenshots to a GIF that repeats. A screenshot after a key press gives two GIF frames: with the
 * label of the key, and then without it. Any other screenshot gives one GIF frame.
 */
function makeGif(gif: string, fonts: { band: string; label: string }): void {
  const shots = readdirSync(frames).filter((f) => f.endsWith('.png')).sort();
  const captioned = join(out, 'captioned');
  mkdirSync(captioned, { recursive: true });
  const lines: string[] = [];
  const add = (file: string, seconds: number) => lines.push(`file '${file}'`, `duration ${seconds}`);
  for (const shot of shots) {
    const plain = join(captioned, shot);
    caption(shot, plain, fonts, false);
    if (existsSync(join(frames, shot.replace(/\.png$/, '.key.txt')))) {
      const labeled = join(captioned, shot.replace(/\.png$/, '-key.png'));
      caption(shot, labeled, fonts, true);
      add(labeled, LABEL_SECONDS);
      add(plain, AFTER_LABEL_SECONDS);
    } else {
      add(plain, FIRST_SECONDS);
    }
  }
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
