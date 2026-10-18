// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Records the animation of the README from a real VS Code: VS Code runs examples/return-object.ts with the Mindbug
// package, and the driver (driver.ts) steps through it and takes a screenshot of the screen at each step.
//
//   xvfb-run -a -s "-screen 0 1440x900x24" npm run gif
//
// Linux only: it needs Xvfb (or another X display), ffmpeg with x11grab, and Deno or Node.js 22.7 or newer on the
// PATH. It builds the package (npm run package), packs the driver as a second extension, downloads VS Code to
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

/** Joins the screenshots to a GIF that repeats, with one GIF frame for each screenshot. */
function makeGif(gif: string): void {
  const shots = readdirSync(frames).filter((f) => f.endsWith('.png')).sort();
  const lines = shots.flatMap((shot, i) => [`file '${join(frames, shot)}'`, `duration ${i === 0 ? FIRST_SECONDS : STEP_SECONDS}`]);
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
makeGif(gif);
console.log(`Wrote ${gif}`);
