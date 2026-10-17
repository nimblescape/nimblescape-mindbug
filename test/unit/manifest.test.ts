// SPDX-License-Identifier: MIT
// © 2026 Hannes Stauss (scalarion@nimblescape.com)
// Licensed under the MIT License. See LICENSE in the repository root for details.

// Checks the manifest, the files of the package, the documents and the license headers of the repository: the
// package keeps the files that the extension loads, the bundle of the extension leaves out only the editor API and the
// built-in modules of Node.js, the documents of the Marketplace link to web addresses only, the README and the user
// guide name every setting, and every source file starts with the license header.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The root folder of this repository, which holds the manifest and the documents. */
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string): string => fs.readFileSync(path.join(repository, file), 'utf8');
const manifest = JSON.parse(read('package.json'));

/** The lines of .vscodeignore without comments and empty lines. */
function ignoreLines(): string[] {
  return read('.vscodeignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** The modules that `entry` imports at run time, with the local modules that it reaches. */
function runtimeImports(entry: string): { local: Set<string>; packages: Set<string> } {
  const pending = [entry];
  const local = new Set<string>();
  const packages = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (local.has(file)) continue;
    local.add(file);
    for (const match of read(file).matchAll(/^import (?!type )[^;]*? from '([^']+)';$/gm)) {
      if (match[1].startsWith('.')) pending.push(path.posix.join(path.posix.dirname(file), match[1]));
      else packages.add(match[1]);
    }
  }
  return { local, packages };
}

describe('the manifest', () => {
  it('follows the naming scheme of the nimblescape extensions', () => {
    expect(manifest.publisher).toBe('nimblescape');
    expect(manifest.name).toBe('nimblescape-mindbug');
    expect(manifest.displayName).toBe('nimblescape Mindbug');
    expect(manifest.license).toBe('MIT');
    expect(manifest.icon).toBe('resources/icon.png');
  });

  it('keeps @types/vscode at the lowest version of the engine range', () => {
    const engine = /^\^(\d+\.\d+)\.\d$/.exec(manifest.engines.vscode);
    expect(engine, 'engines.vscode has the form ^x.y.z').not.toBeNull();
    expect(manifest.devDependencies['@types/vscode']).toBe(`~${engine![1]}.0`);
  });

  it('supports no untrusted and no virtual workspace, because the extension starts programs', () => {
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe(false);
    expect(manifest.capabilities.virtualWorkspaces.supported).toBe(false);
    expect(manifest.extensionKind).toEqual(['workspace']);
  });

  it('shows "Open Mindbug" for the debug types that the controller follows', () => {
    const types = /export const JS_DEBUG_TYPES = \[([^\]]*)\];/.exec(read('src/controller.ts'));
    expect(types, 'src/controller.ts exports JS_DEBUG_TYPES').not.toBeNull();
    const list = types![1].split(',').map((t) => t.trim().replace(/^'|'$/g, ''));
    const open = manifest.contributes.menus['editor/title'].find((m: { command: string }) => m.command === 'nimblescape.mindbug.open');
    expect(open.when).toBe(`inDebugMode && debugType =~ /^(${list.join('|')})$/`);
  });

  it('declares no runtime dependency', () => {
    expect(manifest.dependencies).toBeUndefined();
  });
});

describe('the package', () => {
  it('lists its files in .vscodeignore and keeps every file that the extension loads', () => {
    expect(manifest.main).toBe('./dist/extension.js');
    expect(manifest.files, 'the package lists its files in .vscodeignore').toBeUndefined();
    const ignore = ignoreLines();
    expect(ignore[0], '.vscodeignore ignores everything first').toBe('**');
    const kept = [
      'dist/extension.js',
      'dist/webview.js',
      'dist/webview.css',
      'resources/icon.png',
      'package.json',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'SUPPORT.md',
    ];
    // The icons of the commands of package.json and of the editor (src/controller.ts).
    for (const command of manifest.contributes.commands) {
      if (typeof command.icon === 'object') kept.push(command.icon.light, command.icon.dark);
    }
    kept.push('media/step-arrow.svg');
    for (const file of kept) expect(ignore, `${file} is missing from the files of the package`).toContain(`!${file}`);
    for (const line of ignore.slice(1)) {
      const file = line.slice(1);
      if (!file.startsWith('dist/')) expect(fs.existsSync(path.join(repository, file)), `${file} exists`).toBe(true);
    }
  });

  it('bundles every local module, and leaves out only the editor API and the built-in modules of Node.js', () => {
    const { local, packages } = runtimeImports('src/extension.ts');
    expect(local.has('src/heapWalker.ts'), 'the scan finds the modules that the entry point imports').toBe(true);
    for (const name of packages) expect(name === 'vscode' || name.startsWith('node:'), `the bundle imports ${name}`).toBe(true);
    const view = runtimeImports('webview/main.ts');
    expect([...view.packages], 'the bundle of the view imports no package').toEqual([]);
  });
});

describe('the documents', () => {
  // The package keeps the Markdown links of its documents unchanged (--no-rewrite-relative-links). A relative link
  // outside code would therefore break on the Marketplace page and in the installed extension.
  it('link outside code to web addresses or fragments only, in the documents of the package', () => {
    for (const name of ['README.md', 'CHANGELOG.md', 'SUPPORT.md']) {
      const text = read(name)
        .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '')
        .replace(/`[^`\n]*`/g, '');
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        expect(match[1], `${name} links to the relative target ${match[1]}`).toMatch(/^(https:\/\/|#)/);
      }
    }
  });

  it('name every setting in the README and in the user guide', () => {
    const settings = Object.keys(manifest.contributes.configuration.properties);
    expect(settings.length > 0, 'the manifest contributes settings').toBe(true);
    for (const name of ['README.md', 'docs/guide.md']) {
      const text = read(name);
      for (const setting of settings) expect(text.includes(`\`${setting}\``), `${name} does not name ${setting}`).toBe(true);
    }
  });

  it('link to files of the repository that exist', () => {
    for (const name of ['CONTRIBUTING.md', 'SUPPORT.md', 'docs/guide.md', 'docs/architecture.md', 'docs/security.md']) {
      const text = read(name).replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '');
      for (const match of text.matchAll(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g)) {
        if (/^https?:\/\//.test(match[1])) continue;
        const target = path.join(path.dirname(path.join(repository, name)), match[1]);
        expect(fs.existsSync(target), `${name} links to ${match[1]}, which does not exist`).toBe(true);
      }
    }
  });
});

describe('the license headers', () => {
  const HEADER = [
    'SPDX-License-Identifier: MIT',
    '© 2026 Hannes Stauss (scalarion@nimblescape.com)',
    'Licensed under the MIT License. See LICENSE in the repository root for details.',
  ];

  /** The files below `dir` (relative to the repository), without the folders that tools write. */
  function files(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(path.join(repository, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'out', '.vscode-test', '.git', 'output', 'snapshots', 'images'].includes(entry.name)) out.push(...files(rel));
      } else out.push(rel);
    }
    return out;
  }

  it('start every source, script, workflow and configuration file', () => {
    const checked = files('.').filter((f) => /\.(ts|mts|mjs|js|css|yml|sh)$/.test(f) || /(^|\/)(\.gitignore|\.vscodeignore|tsconfig\.json|launch\.json|tasks\.json)$/.test(f));
    expect(checked.length > 40, 'the scan finds the files').toBe(true);
    for (const file of checked) {
      const head = read(file).split('\n').slice(0, 6).join('\n');
      for (const line of HEADER) expect(head.includes(line), `${file} has no license header`).toBe(true);
    }
  });
});
