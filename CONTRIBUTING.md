# Contributing

This guide explains the files, the development, the tests and the release of
the extension. The [README](README.md) describes the use in short, the
[user guide](docs/guide.md) in full, [architecture.md](docs/architecture.md)
how the extension works inside, and [security.md](docs/security.md) its
security model.

## Files

| File | Purpose |
| --- | --- |
| `src/extension.ts` | The entry point: the controller, the configuration provider of the debug type `mindbug`, and the commands. |
| `src/launch.ts`, `src/runtime.ts` | The debug type `mindbug`, which starts the debug type `ts` of nimblescape TypeScript, and the command **Run with Mindbug**. |
| `src/controller.ts` | Follows the debug sessions of the JavaScript debugger, reads a snapshot at each pause, and marks the line of an earlier step in the editor. |
| `src/snapshot.ts`, `src/v8Connection.ts`, `src/heapWalker.ts` | Build one snapshot with the stack trace of the Debug Adapter Protocol and the requests to V8 through the CDP proxy of the JavaScript debugger, and the helper that runs in the paused program. |
| `src/changes.ts`, `src/model.ts` | The changes between two snapshots, and the types of a snapshot and of the messages of the view. |
| `src/panel.ts`, `src/webviewHtml.ts` | The webview panel "Mindbug" and its HTML page with its content security policy. |
| `webview/` | The view: the step history, the layout, the HTML of the boxes, the arrows and the styles. |
| `test/unit/` | The unit tests with vitest. They need no VS Code. `test/unit/manifest.test.ts` checks the manifest, `.vscodeignore` and the documents. |
| `test/node/` | The tests against real Node.js programs through the V8 inspector, with their programs in `test/node/fixtures/`, and the TypeScript hooks of these tests (`typeScriptHooks.ts`) with their test in Node.js. `typeScript.ts` starts Node.js with these hooks and the TypeScript compiler of VS Code. |
| `test/render/` | The screenshot test (`screenshots.ts`), the recorder of its steps (`record.ts`) and the recorded steps (`snapshots/`). |
| `test/gif/` | The recorder of the animation of the README (`record.ts`), and the driver (`driver.ts`) that runs `examples/return-object.ts`, `examples/blocks.ts` and `examples/closures.ts` in a real VS Code. |
| `test/vscode/`, `.vscode-test.mjs`, `scripts/build-vscode-tests.mjs` | The tests in a real VS Code, their settings, and their build into `out/`. |
| `examples/` | The example programs, with a `launch.json` file. The tests in VS Code and the screenshot test use them. |
| `docs/` | The user guide, the architecture, the security model, and the images in `docs/images/`: the GIF of the README, from `npm run gif`, and the screenshots of the user guide, from the screenshot test. `stack-and-heap.png` is a screenshot of the README of the release 0.1.1, whose page on the Marketplace still shows it; delete it after the next release. `return-object.gif` is the GIF of the README of the release 0.1.5, whose page on the Marketplace still shows it; delete it after the next release. |
| `dist/` | The bundles `dist/extension.js` and `dist/webview.js`, and `dist/webview.css`, built by `esbuild.mjs` and kept out of Git. |
| `media/` | The icons of the command **Open Mindbug** and of the line of an earlier step in the editor. |
| `resources/icon.png`, `resources/icon.svg` | The Marketplace icon (256 × 256 PNG, because the Marketplace takes no SVG icon) and its source: two scopes of the stack and one object on the heap, on the tile of the nimblescape extensions. |
| `esbuild.mjs` | Bundles the extension and the view. The bundles are readable: not minified. A production build (`--production`) has no source map. |
| `tsconfig.json` | The TypeScript settings of the type check: strict, and no output, because esbuild builds the bundles. |
| `vitest.config.mts`, `vitest.node.config.mts` | The settings of the unit tests (`test/unit/**/*.test.ts` and `scripts/**/*.test.mjs`) and of the tests against Node.js programs. |
| `package.json` | The extension manifest. The section [Manifest](#manifest) explains it. |
| `package-lock.json` | The locked development tools. npm writes this file, and nobody edits it by hand. |
| `.node-version` | The Node release of the development tools. `actions/setup-node` in the workflows and local Node version managers read it. |
| `.vscodeignore` | Lists the files of the package: the bundles, `dist/webview.css`, the icons of `media/`, `resources/icon.png`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `SUPPORT.md`. |
| `.github/workflows/ci.yml` | Checks the types, runs all tests and packages every push to `main`, every pull request and the commit of every release. The release publishes the VSIX of this workflow, so a change of it needs a dry run (rule 4 of the [release rules](#release-rules)). |
| `.github/workflows/vscode-versions.yml` | Runs the tests in VS Code once per week on VS Code Insiders and on the lowest supported version. |
| `.github/workflows/release.yml` | Releases a version on a manual start: commits the version to a temporary branch, tests and packages it with `ci.yml`, and only then moves `main` to it, creates its tag and GitHub release and publishes it to the Marketplace. A dry run tests without a change. The section [Release](#release) explains it. |
| `.github/workflows/release-dry-run.yml` | Fails on a pull request that changes the release process (`release.yml`, `ci.yml` or `scripts/release-checks.mjs`) until a dry run on its branch tested the change (rule 4 of the [release rules](#release-rules)). |
| `.github/workflows/marketplace-identity.yml` | Prints the Marketplace member ID of the publishing identity, to check the setup of the repository. |
| `.github/dependabot.yml` | Proposes weekly updates of the development tools and of the pinned actions. |
| `scripts/install-local.mjs`, `scripts/uninstall-local.mjs` | Install the built package into every profile of the VS Code of this computer, and remove it again. |
| `scripts/marketplace-setup.sh` | Sets up the Marketplace publishing of the repository. The section [Setup of a repository](#setup-of-a-repository) explains it. |
| `scripts/release-checks.mjs`, `scripts/release-checks.test.mjs` | The check of rule 4 of the [release rules](#release-rules), which the workflows run, and its test. |
| `.vscode/launch.json`, `.vscode/tasks.json` | Build the bundles and start a VS Code window that loads the extension from this folder and opens `examples/`. |

## Development

The extension uses VS Code APIs and has no npm runtime dependency. The
development tools are TypeScript, esbuild, vitest, mocha with
`@vscode/test-cli`, Playwright for the screenshots, and
[`@vscode/vsce`](https://github.com/microsoft/vscode-vsce), the Microsoft tool
that packages and publishes extensions. Everything runs on Node.js 24: the
release in `.node-version` for the tools and CI, and the runtime of VS Code
(`engines.vscode`) for the extension. The tests in VS Code run the programs
with the debug type `ts` of nimblescape TypeScript, which test-cli installs.
The tests against Node.js programs take the TypeScript compiler of the VS Code
that `npm run test:vscode` downloads, so CI runs `npm run test:node` after it.

| Command | Effect |
| --- | --- |
| `npm ci --ignore-scripts` | Installs the locked development tools and runs no install script of a dependency. |
| `npm run typecheck` | Checks the types with `tsc`. esbuild does not check them. |
| `npm test` | Runs the unit tests with vitest. They touch no installed editor. |
| `npm run test:node` | Runs the tests against real Node.js programs, with the Node.js that runs npm. Run `npm run test:vscode` first, so that the tests find the TypeScript compiler of VS Code in `.vscode-test/`. |
| `npm run record` | Records the steps of the examples with Node.js into `test/render/snapshots/`, after a change of the examples or of the snapshot. |
| `npm run test:render` | Draws the recorded steps in Chromium and writes screenshots in the light, dark and high contrast themes to `test/render/output/`. Copy changed screenshots to `docs/images/`. |
| `npm run gif` | Records the animation of the README from a real VS Code, on Linux only: `xvfb-run -a -s "-screen 0 1440x816x24" npm run gif`. It builds the package, installs it with the driver of `test/gif/` into a new profile of the downloaded VS Code, steps through `examples/return-object.ts` with F5 (the launch configuration "Mindbug: current file" of `examples/.vscode/launch.json`), Step Into and Step Over, and goes back through the step history. Then it turns the switch "Stop on entry" off and runs `examples/blocks.ts` and `examples/closures.ts` with F5 to their breakpoints. It joins the screenshots with ffmpeg to `test/gif/output/mindbug-run.gif`. The GIF has the style of the GIFs of nimblescape PlantUML and nimblescape Comment Links: a VS Code window of 1440 × 816 pixels in the theme Dark Modern, a blue band above it with the number and the caption of each scene, and for 1.6 s after each key press a label with the key and its command. The zoom is 110 %, not 120 % as in the other GIFs: the toolbar of the view needs two lines for its six switches, and at 120 % the view has no room for the object of the return step and for the parts of the nested blocks. The steps and the captions are in `test/gif/driver.ts`. It needs ffmpeg (with `x11grab` and `drawtext`), xdotool, the font Inter (Debian and Ubuntu: `fonts-inter`), and Node.js on the `PATH` for the command `ts`. VS Code installs nimblescape TypeScript from the Marketplace, or from the VSIX file that `MINDBUG_TS_VSIX` names. Run it as a user that is not root: VS Code shows a warning and "[Superuser]" in the title for root. Copy the GIF to `docs/images/` after a check. |
| `npm run test:vscode` | Downloads VS Code to `.vscode-test/`, installs the pinned release of nimblescape TypeScript (`.vscode-test.mjs`), and runs the tests in VS Code. Its command `ts` runs the examples with the Node.js of the `PATH`. To test with a build of nimblescape TypeScript before its release, set `MINDBUG_TS_VSIX` to the path of its VSIX file. On Linux without a display, run it under `xvfb-run -a`. `VSCODE_TEST_VERSION` selects the VS Code version: `stable` (the default), `insiders` or a version such as `1.125.0`. |
| `npm run build` | Bundles `dist/` with source maps; `npm run watch` bundles again after each change. |
| `npm run package` | Builds `nimblescape-mindbug-<version>.vsix` with vsce, which first runs the production build (`vscode:prepublish`). vsce also validates the manifest and the README. |
| `npm run install-local` | Builds the package and installs it into every profile of the VS Code of this computer; `-- --profile <name>` installs into one profile. |
| `npm run uninstall-local` | Removes `nimblescape.nimblescape-mindbug` from every profile of the VS Code of this computer. |

The launch configuration "Run the extension" builds the bundles and starts a
second VS Code window that loads the extension from this folder and opens
`examples/`, so that a change can be tried without a package.

The examples are part of the tests: the tests in VS Code set breakpoints at
lines of `examples/*.ts`, and the screenshot test draws the recorded steps of
the examples. After a change of an example, adapt the lines in
`test/vscode/extension.test.ts`, run `npm run record`, and check the
screenshots. After a change of `examples/return-object.ts`, `examples/blocks.ts`
or `examples/closures.ts`, adapt the lines in `test/gif/driver.ts` and run
`npm run gif`.

## Reviewing the package

The VSIX holds the two bundles of `dist/` as readable JavaScript: not
minified, with the names of the source. To compare a VSIX with the sources,
unpack it (a VSIX is a ZIP file), run `npm ci --ignore-scripts` and
`npm run vscode:prepublish` at the tag of its version, and compare
`extension/dist/` of the VSIX with `dist/`. With the same sources and the
locked versions of the tools, the build gives the same files.

## Manifest

`package.json` is the extension manifest. It has these parts:

- The name and the publisher define the extension ID `nimblescape.nimblescape-mindbug`; the section [Naming](#naming) explains the name.
- The version is the only source of the package version, and the tag of a release names it.
- The engine range defines the compatible VS Code versions. `@types/vscode` stays at the lowest version of that range, and the workflow "VS Code versions" tests that version.
- `main` selects the bundle `dist/extension.js`. A test checks it.
- `.vscodeignore` lists the files of the package, not a `files` field: it ignores everything and keeps the bundles, the style sheet, the icons, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `SUPPORT.md`. A test checks the list, and that the bundle of the extension leaves out the editor API and the built-in modules of Node.js only.
- `extensionDependencies` names nimblescape TypeScript (`nimblescape.nimblescape-typescript`), whose debug type `ts` runs the programs. VS Code installs it together with Mindbug. A test checks it.
- `extensionKind` selects the workspace host, where the files and the runtimes are, also on a remote host.
- The activation event `onDebug` activates the extension when a debug session starts; the commands activate it too.
- `contributes` declares the commands, the menus, the settings and the debug type `mindbug`, with the attributes of its launch configuration and its snippet.
- `capabilities` states that the extension supports neither untrusted nor virtual workspaces: it starts programs, and the runtimes need files on the disk.
- The icon, the description, the categories, the keywords and the banner color complete the Marketplace page.
- The development dependencies are the build, test and packaging tools. `overrides` pins newer versions of packages inside `@vscode/test-cli` (mocha's `diff`, `glob` and `serialize-javascript`), and `allowScripts` lists the install scripts of dependencies that npm 11.19 and later may run: those of esbuild and `@vscode/vsce-sign` in every version, because the build and the packaging (`npm run package`) run the code of both packages anyway and Dependabot updates them, and not the one of fsevents, an optional package for macOS that already contains its built binary. The manifest declares no runtime dependency.

The settings table of the README and of the user guide follows the
configuration contribution. A test checks that both name every setting.

`README.md` is the page of the Marketplace and `CHANGELOG.md` its tab
"Changelog". vsce does not rewrite relative links
(`--no-rewrite-relative-links`), so both use full `https://…` links outside
code. A test checks it.

## Naming

Every extension of the publisher `nimblescape` uses one name,
`nimblescape-<name>`, for the repository, the package and the extension:

| What | Form | This extension |
| --- | --- | --- |
| Repository | `nimblescape/nimblescape-<name>` | `nimblescape/nimblescape-mindbug` |
| `name` in `package.json` | `nimblescape-<name>` | `nimblescape-mindbug` |
| Extension ID | `nimblescape.nimblescape-<name>` | `nimblescape.nimblescape-mindbug` |
| Package file | `nimblescape-<name>-<version>.vsix` | `nimblescape-mindbug-<version>.vsix` |
| Display name | `nimblescape <Title>` | `nimblescape Mindbug` |

The prefix keeps the name apart from the names of other publishers, because
the Marketplace accepts a `name` only once. The Marketplace cannot rename an
extension ID: another `name` publishes a new extension, and the old one stays
with its installations. An extension that is no longer wanted is unpublished
(More Actions > Unpublish; this can be undone), never removed: the Marketplace
keeps the `name` of a removed extension reserved permanently, also for its own
publisher.

## Release

A released version is a tag `v<version>` whose `<version>` equals the version
in `package.json`. The workflow "Release" creates the version, its tag, its
GitHub release and its Marketplace version in one run. To release a version,
follow these steps:

1. Optional: add a section `## <version>` to `CHANGELOG.md` on `main`. The section describes the changes for the users (see [Release rules](#release-rules)).
2. In the tab "Actions", choose the workflow "Release", then "Run workflow" on the branch `main`. Enter the version, for example `0.1.7`. When `CHANGELOG.md` has no section for the version, enter its notes too: they become the section. The GitHub website starts a workflow also in the browser of a phone.

The run has four jobs:

1. "Version commit" checks that the run starts from `main`, that the version has the form `<major>.<minor>.<patch>`, that it is not lower than the version in `package.json` and that its tag does not exist, and, in a release, that a dry run tested the files of the release process with `scripts/release-checks.mjs dry-run` (rule 4 of the [release rules](#release-rules)). It sets the version in `package.json` and `package-lock.json`, adds the section of the notes to `CHANGELOG.md` when the file has none, commits the change as "Release `<version>`" and pushes it to the temporary branch `release/run-<run ID>`, not to `main`. When `main` holds the version and its section already, it commits nothing. It also deletes the temporary branches of earlier runs that failed.
2. "CI" runs the workflow `ci.yml` for the commit of the version, because a push with the token of a workflow starts no other workflow. The VSIX that this job tests and builds is the VSIX of the release, so the release repeats no test and no build.
3. "Main, tag and GitHub release" runs only when CI passed. It moves `main` to the commit of the version as a fast-forward and deletes the temporary branch. When `main` changed during the run, it stops before the tag. Then it creates the tag `v<version>` on the commit and the release of the tag with the GitHub CLI `gh`. The section of the version in `CHANGELOG.md` becomes the notes, and the VSIX becomes the file of the release. A release that exists keeps its notes and receives the VSIX only when it holds none.
4. "Publish to the Visual Studio Marketplace" downloads the VSIX of the GitHub release, signs in to Microsoft Entra ID with the official [`azure/login`](https://github.com/Azure/login) action and publishes the VSIX with `vsce publish --azure-credential`.

`main` receives the version commit only after CI passed. When CI fails,
`main`, the tags, the releases and the Marketplace stay unchanged, and the
version can still be released: fix the cause on `main` and start the release
of the same version again. The jobs move and push with the token of the
workflow, so a rule of `main` that blocks direct pushes stops the release.

A dry run tests a release without a change: choose "Dry run" when you start
the workflow. The run makes the version commit on its temporary branch, runs
CI for it and deletes the branch; it changes neither `main`, a tag, a release
nor the Marketplace. Its run name ends with "(dry run)". A dry run may start
from another branch than `main`, so it also tests a change of `release.yml` on
that branch before the change reaches `main`.

When a job fails, remove the cause and choose "Re-run failed jobs" on the
run. A re-run keeps the tag and the VSIX that the GitHub release already
holds, and the Marketplace skips a version that it already holds, so a re-run
never publishes a version twice. When the publish job fails, for example
because the Marketplace refuses the package, the tag and the GitHub release
stay, and the re-run publishes the VSIX of the GitHub release. GitHub allows a
re-run only within 30 days of the run; after that, only a new version can
reach the Marketplace. A new run deletes the temporary branch of a failed run,
so a failed run can no longer be re-run after a new run started.

The Marketplace refuses a package with more than 30 tags, with the error "You
exceeded the number of allowed tags of 30", which the Microsoft publishing
guide names. The tags are the keywords of `package.json` and the tags that
vsce adds, for example the language of each `onLanguage` event in
`activationEvents`; the element `<Tags>` of `extension.vsixmanifest` in the
VSIX lists them. No job counts them before the tag.

The workflows `release.yml`, `release-dry-run.yml` and
`marketplace-identity.yml`, the script `scripts/release-checks.mjs` with its
test `scripts/release-checks.test.mjs`, and this section are the same in every
extension repository of nimblescape. A change to them goes into every
repository.

### Release rules

Every extension of nimblescape follows these rules. Only rule 4 has a check
in the workflows, `scripts/release-checks.mjs dry-run`; everyone follows the
other rules without a check.

1. **The ID never changes.** An extension keeps its ID `nimblescape.nimblescape-<name>` (see [Naming](#naming)), and nimblescape never publishes an extension under a new ID.
2. **No deletion.** nimblescape never deletes an extension. No workflow, npm script or file of `scripts/` runs `vsce unpublish`, which deletes the extension on the Marketplace, or `vsce delete-publisher`, which deletes the publisher with all its extensions. On the publisher management page, nobody uses More Actions > Remove, which deletes the extension and keeps its name reserved permanently, or "Delete this version" (More Actions > Reports, tab Manage), after which the number of the version can never be used again. An extension that is no longer wanted is unpublished on the publisher management page, as [Naming](#naming) describes.
3. **Only changes for the users, at most one version in 7 days.** A version is published only when it changes something for the users, its section in `CHANGELOG.md` describes that change, and at least 7 days passed since the newest release; an urgent fix may come earlier. A change for the users changes the extension that VS Code runs: its code (`src/`, which the build bundles into `dist/`), another file of the package that is not a document, for example the icon of a view, or a field of `package.json` that changes how the extension works, for example `contributes`. A change only of the documents (for example the README), the Marketplace icon, the tests or the build tools (for example `esbuild.mjs`, `tsconfig.json` or a file of `scripts/`) does not count: it reaches the users with the next version that changes the extension. Images that only the README shows do not belong in the package: the README links them with full `https://github.com/…` links (see [Manifest](#manifest)). The section of the version in `CHANGELOG.md` does not say "maintenance release", "behaves as in" followed by a version, or a phrase of that kind.
4. **Dry run first.** A change of the release process is tested with a dry run before it reaches `main`. The files of the release process are `release.yml`, `ci.yml`, whose VSIX the release publishes, and `scripts/release-checks.mjs`. The workflow "Release dry run" runs on every pull request. When the pull request changes one of these files, also in an update by Dependabot, the check `dry-run` fails until a successful dry run, or the newest release, had these files as they are at the head of the pull request. Start the workflow "Release" on the branch of the pull request with "Dry run" and a version without a tag (with notes when `CHANGELOG.md` has no section for the version), then re-run the job "release dry run" of the pull request. A pull request from a fork cannot meet the rule, because the dry run needs a branch of this repository. The job "Version commit" of a release runs the check `dry-run` again, so a change that reached `main` without a dry run stops the release until a dry run tested it. Do not make "release dry run" a required check of `main`: the release moves `main` to its version commit, which has no result of the check.
5. **Only GitHub Actions with Microsoft Entra ID.** Only the job "Publish to the Visual Studio Marketplace" publishes, signed in with the app registration of [Marketplace setup](#marketplace-setup). No personal access token exists for the publisher. No other workflow, npm script or file of `scripts/` runs `vsce publish` or `vsce login`. Nobody uploads a VSIX on the publisher management page or runs `vsce publish`, `unpublish`, `delete-publisher` or `login` on a computer.

## Marketplace setup

The workflow publishes with a Microsoft Entra ID token, as the
[Microsoft publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
recommends. It uses no personal access token, because Azure DevOps retires
the global personal access tokens that the Marketplace needs on
1 December 2026. The publishing identity is an app registration with a
federated credential for each repository: GitHub Actions proves the identity
of the job with an OpenID Connect token, so no secret is stored. An app
registration needs no Azure subscription. One app registration publishes
every extension of the publisher `nimblescape`, because the Marketplace
grants the role of a member for the whole publisher.

### What exists

| Part | Where | Value |
| --- | --- | --- |
| Publisher | [Marketplace publisher management](https://marketplace.visualstudio.com/manage) | `nimblescape`, the `publisher` in `package.json` |
| App registration | [Microsoft Entra admin center](https://entra.microsoft.com), "App registrations" | `vscode-marketplace-publisher`, a member of the publisher `nimblescape` with the role "Contributor" |
| Organization variables | GitHub organization `nimblescape`, "Secrets and variables", "Actions", "Variables" | `AZURE_CLIENT_ID` (the application ID of the app) and `AZURE_TENANT_ID` (its directory ID); identifiers, not secrets |
| Federated credential | the app, "Certificates & secrets", "Federated credentials" | one for each repository, named after it |
| Environment | the settings of each repository, "Environments" | `marketplace`, reachable from the tags `v*` and the branch `main` only |

### Setup of a repository

A new extension repository needs its federated credential and its
environment. The script `scripts/marketplace-setup.sh` sets both up for the
GitHub repository of the remote `origin` of the clone, whose name must be the
`name` of `package.json`; it needs the Azure CLI, the GitHub CLI and Node.js,
the two CLIs signed in with an account that may change the app registration
and the settings of the repository. It shows what it sets up and
asks before it changes anything. It changes nothing that already exists, so it
can run again:

```sh
az login --allow-no-subscriptions
gh auth login
scripts/marketplace-setup.sh
```

Then run the workflow "Marketplace identity" in the tab "Actions" of the
repository: it signs in like the publish job and prints the member ID of the
app, which shows that the setup works.

The script gives the credential these values. For this repository:

| Field of the federated credential | Value |
| --- | --- |
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject | `repo:nimblescape@156021698/nimblescape-mindbug@1422240700:environment:marketplace` |
| Audience | `api://AzureADTokenExchange` |

GitHub puts the owner ID and the repository ID into the subject of every
repository created after 15 July 2026, so a new owner of a reused name gets no
token. The subject also holds the name of the repository: after a rename of
the repository, run the script again and delete the credential of the old
name. One app accepts at most 20 federated credentials.

### Setup from scratch

Only when the publisher, the app or the variables are lost:

1. Create the publisher `nimblescape` on the publisher management page, signed in with the Microsoft account of nimblescape e.U.
2. Register the app `vscode-marketplace-publisher` in the Entra admin center: "New registration", "Single tenant", no API permission, no secret.
3. Set the organization variables `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` to the application ID and the directory ID of the app. Organization variables reach private repositories only on a paid GitHub plan.
4. Set up a repository with the script, and run its workflow "Marketplace identity".
5. On the publisher management page, open the publisher `nimblescape`, then "Members", and add the member ID that the workflow printed with the role "Contributor".

---

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](LICENSE).
