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
| `src/launch.ts`, `src/runtime.ts` | The debug type `mindbug`, the command **Run with Mindbug**, and the choice of Deno or Node.js. |
| `src/controller.ts` | Follows the debug sessions of the JavaScript debugger, reads a snapshot at each pause, and marks the line of an earlier step in the editor. |
| `src/snapshot.ts`, `src/heapWalker.ts` | Build one snapshot with the requests of the Debug Adapter Protocol, and the helper that runs in the paused program. |
| `src/changes.ts`, `src/model.ts` | The changes between two snapshots, and the types of a snapshot and of the messages of the view. |
| `src/panel.ts`, `src/webviewHtml.ts` | The webview panel "Mindbug" and its HTML page with its content security policy. |
| `webview/` | The view: the step history, the layout, the HTML of the boxes, the arrows and the styles. |
| `test/unit/` | The unit tests with vitest. They need no Deno and no VS Code. `test/unit/manifest.test.ts` checks the manifest, `.vscodeignore` and the documents. |
| `test/deno/` | The tests against real Deno programs through the V8 inspector, with their programs in `test/deno/fixtures/`. |
| `test/render/` | The screenshot test (`screenshots.ts`), the recorder of its steps (`record.ts`) and the recorded steps (`snapshots/`). |
| `test/gif/` | The recorder of the animation of the README (`record.ts`), and the driver (`driver.ts`) that steps through `examples/return-object.ts` in a real VS Code. |
| `test/vscode/`, `.vscode-test.mjs`, `scripts/build-vscode-tests.mjs` | The tests in a real VS Code, their settings, and their build into `out/`. |
| `examples/` | The example programs, with a `launch.json` file. The tests in VS Code and the screenshot test use them. |
| `docs/` | The user guide, the architecture, the security model, and the images of the README (`docs/images/`, copied from the output of the screenshot test and of `npm run gif`). |
| `dist/` | The bundles `dist/extension.js` and `dist/webview.js`, and `dist/webview.css`, built by `esbuild.mjs` and kept out of Git. |
| `media/` | The icons of the command **Open Mindbug** and of the line of an earlier step in the editor. |
| `resources/icon.png`, `resources/icon.svg` | The Marketplace icon (256 × 256 PNG, because the Marketplace takes no SVG icon) and its source: two scopes of the stack and one object on the heap, on the tile of the nimblescape extensions. |
| `esbuild.mjs` | Bundles the extension and the view. Both bundles are readable: not minified. A production build (`--production`) has no source map. |
| `tsconfig.json` | The TypeScript settings of the type check: strict, and no output, because esbuild builds the bundles. |
| `vitest.config.mts`, `vitest.deno.config.mts` | The settings of the unit tests (`test/unit/**/*.test.ts` and `scripts/**/*.test.mjs`) and of the tests against Deno. |
| `package.json` | The extension manifest. The section [Manifest](#manifest) explains it. |
| `package-lock.json` | The locked development tools. npm writes this file, and nobody edits it by hand. |
| `.node-version` | The Node release of the development tools. `actions/setup-node` in the workflows and local Node version managers read it. |
| `.vscodeignore` | Lists the files of the package: the bundles, `dist/webview.css`, the icons of `media/`, `resources/icon.png`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `SUPPORT.md`. |
| `.github/workflows/ci.yml` | Checks the types, runs all tests and packages every push to `main`, every pull request and the commit of every release, and checks the [release rules](#release-rules) of the source. The release publishes the VSIX of this workflow, so a change of it needs a dry run (rule 4 of the [release rules](#release-rules)). |
| `.github/workflows/vscode-versions.yml` | Runs the tests in VS Code once per week on VS Code Insiders and on the lowest supported version. |
| `.github/workflows/release.yml` | Releases a version on a manual start: commits the version to a temporary branch, tests and packages it with `ci.yml`, and only then moves `main` to it, creates its tag and GitHub release and publishes it to the Marketplace. A dry run tests without a change. The section [Release](#release) explains it. |
| `.github/workflows/release-dry-run.yml` | Fails on a pull request that changes the release process (`release.yml`, `ci.yml` or `scripts/release-checks.mjs`) until a dry run on its branch tested the change (rule 4 of the [release rules](#release-rules)). |
| `.github/workflows/marketplace-identity.yml` | Prints the Marketplace member ID of the publishing identity, to check the setup of the repository. |
| `.github/dependabot.yml` | Proposes weekly updates of the development tools and of the pinned actions. |
| `scripts/install-local.mjs`, `scripts/uninstall-local.mjs` | Install the built package into every profile of the VS Code of this computer, and remove it again. |
| `scripts/marketplace-setup.sh` | Sets up the Marketplace publishing of the repository. The section [Setup of a repository](#setup-of-a-repository) explains it. |
| `scripts/release-checks.mjs`, `scripts/release-checks.test.mjs` | The checks of the [release rules](#release-rules), which the workflows run, and their test. |
| `.vscode/launch.json`, `.vscode/tasks.json` | Build the bundles and start a VS Code window that loads the extension from this folder and opens `examples/`. |

## Development

The extension uses VS Code APIs and has no npm runtime dependency. The
development tools are TypeScript, esbuild, vitest, mocha with
`@vscode/test-cli`, Playwright for the screenshots, and
[`@vscode/vsce`](https://github.com/microsoft/vscode-vsce), the Microsoft tool
that packages and publishes extensions. Everything runs on Node.js 24: the
release in `.node-version` for the tools and CI, and the runtime of VS Code
(`engines.vscode`) for the extension. The tests against Deno and in VS Code
also need Deno 2 on the `PATH` (CI installs the release that `ci.yml` names,
and checks its SHA-256 sum).

| Command | Effect |
| --- | --- |
| `npm ci --ignore-scripts` | Installs the locked development tools and runs no install script of a dependency. |
| `npm run typecheck` | Checks the types with `tsc`. esbuild does not check them. |
| `npm test` | Runs the unit tests with vitest. They touch no installed editor. |
| `npm run test:deno` | Runs the tests against real Deno programs (Deno on the `PATH`, or `DENO_PATH`). |
| `npm run record` | Records the steps of the examples with Deno into `test/render/snapshots/`, after a change of the examples or of the snapshot. |
| `npm run test:render` | Draws the recorded steps in Chromium and writes screenshots in the light, dark and high contrast themes to `test/render/output/`. Copy changed screenshots to `docs/images/`. |
| `npm run gif` | Records the animation of the README from a real VS Code, on Linux only: `xvfb-run -a -s "-screen 0 1440x900x24" npm run gif`. It builds the package, installs it with the driver of `test/gif/` into a new profile of the downloaded VS Code, steps through `examples/return-object.ts` with F5 (the launch configuration "Mindbug: current file" of `examples/.vscode/launch.json`), Step Into and Step Over, goes back through the step history, and joins the screenshots with ffmpeg to `test/gif/output/return-object.gif`. The captions have the style of the GIF of nimblescape-plantuml: a blue band above the window with the number and the caption of each scene, and a label with each pressed key and its command. The steps and the captions are in `test/gif/driver.ts`. It needs ffmpeg (with `x11grab` and `drawtext`), the font Inter (Debian and Ubuntu: `fonts-inter`), and Deno or Node.js on the `PATH`. Run it as a user that is not root: VS Code shows a warning and "[Superuser]" in the title for root. Copy the GIF to `docs/images/` after a check. |
| `npm run test:vscode` | Downloads VS Code to `.vscode-test/`, and runs the tests in VS Code with Deno and Node.js. On Linux without a display, run it under `xvfb-run -a`. `VSCODE_TEST_VERSION` selects the VS Code version: `stable` (the default), `insiders` or a version such as `1.125.0`. |
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
screenshots. After a change of `examples/return-object.ts`, adapt the lines in
`test/gif/driver.ts` and run `npm run gif`.

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
- `.vscodeignore` lists the files of the package, not a `files` field: it ignores everything and keeps the bundles, the style sheet, the icons, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE` and `SUPPORT.md`. A test checks the list and that the bundle of the extension leaves out the editor API and the built-in modules of Node.js only.
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
2. In the tab "Actions", choose the workflow "Release", then "Run workflow" on the branch `main`. Enter the version, for example `0.1.7`. When `CHANGELOG.md` has no section for the version, enter its notes too: they become the section. Only for an urgent fix within 7 days of the newest release, enter the reason in "urgent": one line, at least 20 characters (rule 3). The GitHub website starts a workflow also in the browser of a phone.

The run has six jobs:

1. "Version commit" checks that the run starts from `main`, that the version has the form `<major>.<minor>.<patch>`, that it is not lower than the version in `package.json` and that its tag does not exist, and it checks the [release rules](#release-rules) of the source with `scripts/release-checks.mjs rules`, the 7 days since the newest release with `scripts/release-checks.mjs interval` and, in a release, that a dry run tested the files of the release process with `scripts/release-checks.mjs dry-run`. It sets the version in `package.json` and `package-lock.json`, adds the section of the notes to `CHANGELOG.md` when the file has none, commits the change as "Release `<version>`", for an urgent fix with the line `Urgent: <reason>`, and pushes it to the temporary branch `release/run-<run ID>`, not to `main`. When `main` holds the version and its section already, it commits nothing. It also deletes the temporary branches of earlier runs that failed.
2. "CI" runs the workflow `ci.yml` for the commit of the version, because a push with the token of a workflow starts no other workflow. The VSIX that this job tests and builds is the VSIX of the release, so the release repeats no test and no build.
3. "Check the package" checks the VSIX of CI with `scripts/release-checks.mjs package`: the VSIX holds the extension ID and the version of `package.json`, it has at most 30 tags (see "Checks before the tag" in [Release rules](#release-rules)), it changes something for the users since the newest release before the version, and the section of the version in its change log describes the change (rule 3).
4. "Check the Marketplace" runs at the same time as CI, only in a release and in the environment `marketplace`. It signs in to Microsoft Entra ID like the publish job and checks with `vsce verify-pat --azure-credential` that the app registration has a role on the publisher `nimblescape`. The check changes nothing.
5. "Main, tag and GitHub release" runs only when CI, the check of the package and the check of the Marketplace passed. It moves `main` to the commit of the version as a fast-forward and deletes the temporary branch. When `main` changed during the run, it stops before the tag. Then it creates the tag `v<version>` on the commit and the release of the tag with the GitHub CLI `gh`. The section of the version in `CHANGELOG.md` becomes the notes, and the VSIX becomes the file of the release. A release that exists keeps its notes and receives the VSIX only when it holds none.
6. "Publish to the Visual Studio Marketplace" downloads the VSIX of the GitHub release, checks it again as the job "Check the package" does, signs in to Microsoft Entra ID with the official [`azure/login`](https://github.com/Azure/login) action and publishes the VSIX with `vsce publish --azure-credential`.

`main` receives the version commit only after CI, the check of the package
and the check of the Marketplace passed. When one of them fails, `main`, the
tags, the releases and the Marketplace stay unchanged, and the version can
still be released: fix the cause on `main` and start the release of the same
version again. The jobs move and push with the token of the workflow, so a rule
of `main` that blocks direct pushes stops the release.

A dry run tests a release without a change: choose "Dry run" when you start
the workflow. The run makes the version commit on its temporary branch, runs
CI and the check of the package for it and deletes the branch; it changes
neither `main`, a tag, a release nor the Marketplace. Its run name ends with
"(dry run)". A dry run may start from another branch than `main`, so it also
tests a change of `release.yml` on that branch before the change reaches
`main`. In a dry run, the checks of rule 3 only warn, so that a change of the
release process can be tested also when there is no change for the users to
release and within 7 days of the newest release.

When a job fails, remove the cause and choose "Re-run failed jobs" on the
run. A re-run keeps the tag and the VSIX that the GitHub release already
holds, and the Marketplace skips a version that it already holds, so a re-run
never publishes a version twice. A new run deletes the temporary branch of a
failed run, so a failed run can no longer be re-run after a new run started.

The workflows `release.yml`, `release-dry-run.yml` and
`marketplace-identity.yml`, the script `scripts/release-checks.mjs` with its
test `scripts/release-checks.test.mjs`, and this section are the same in every
extension repository of nimblescape. A change to them goes into every
repository.

### Release rules

Every extension of nimblescape follows these rules. The script
`scripts/release-checks.mjs` checks each rule that a program can check, and
the workflows run it. The checks also run in a clone, for example
`node scripts/release-checks.mjs rules`.

1. **The ID never changes.** An extension keeps its ID `nimblescape.nimblescape-<name>` (see [Naming](#naming)), and nimblescape never publishes an extension under a new ID. The check `rules`, in CI and in the job "Version commit", fails when `publisher` is not `nimblescape`, when `name` does not have the form `nimblescape-<name>` or is not the name of the repository, when `displayName` does not have the form `nimblescape <Title>`, or when the ID differs from the ID of the newest release tag. The check `package`, in the jobs "Check the package" and "Publish to the Visual Studio Marketplace", fails when the VSIX holds another ID or version than `package.json`.
2. **No deletion.** nimblescape never deletes an extension. The check `rules` fails when a workflow, an action, an npm script or a file of `scripts/` runs `vsce unpublish`, which deletes the extension on the Marketplace, or `vsce delete-publisher`, which deletes the publisher with all its extensions. On the publisher management page, nobody uses More Actions > Remove, which deletes the extension and keeps its name reserved permanently, or "Delete this version" (More Actions > Reports, tab Manage), after which the number of the version can never be used again. An extension that is no longer wanted is unpublished on the publisher management page, as [Naming](#naming) describes.
3. **Only changes for the users, at most one version in 7 days.** A version is published only when it changes something for the users, its section in `CHANGELOG.md` describes that change, and at least 7 days passed since the newest release. The check `package` compares the VSIX with the package of the newest release before the version. These changes count: a file of the package that is not a document, not the Marketplace icon, not `package.json` and not in `dist/`, for example the icon of a view; a field of `package.json` that changes how the extension works, for example `contributes`; and a bundle in `dist/`, when the version also changes a file of `src/` that is not a test. These do not count: the documents (the files `.md` in any folder of the package, the files `.txt` at its top, and the license), the Marketplace icon (the file that the field `icon` of `package.json` names), the other fields of `package.json`, which do not change how the extension works (for example `displayName`, `description` and `icon`), the tests and the build tools. A file `.md` or the Marketplace icon counts when `contributes` names it, for example the page of a walkthrough, because VS Code then shows it at run time. A change only of the build, for example of `esbuild.mjs`, `tsconfig.json` or a file of `scripts/`, does not count: it reaches the users with the next change of `src/`. Images that only the README shows do not belong in the package: the README links them with full `https://github.com/…` links (see [Manifest](#manifest)), and the check counts the other files of the package. The check fails when nothing counts. It also fails when the section of the version in `CHANGELOG.md` is missing, has no text other than headings and HTML comments, or says "maintenance release", "behaves as in" followed by a version, or a phrase of that kind. The check `interval`, in the job "Version commit", fails when the GitHub release of the newest tag before the version is less than 7 days old. For an urgent fix, the input "urgent" gives the reason: one line, at least 20 characters. The check then passes with a notice, the run name shows "(urgent)", and the version commit keeps the reason. After the 7 days and before the first release, the check still refuses a shorter reason, and a valid reason gives only a notice that the release does not need the input. No input lets a version without a change for the users pass. A failed check stops the release before its tag.
4. **Dry run first.** A change of the release process is tested with a dry run before it reaches `main`. The files of the release process are `release.yml`, `ci.yml`, whose VSIX the release publishes, and `scripts/release-checks.mjs`. The workflow "Release dry run" runs on every pull request. When the pull request changes one of these files, also in an update by Dependabot, the check `dry-run` fails until a successful dry run, or the newest release, had these files as they are at the head of the pull request. Start the workflow "Release" on the branch of the pull request with "Dry run" and a version without a tag (with notes when `CHANGELOG.md` has no section for the version), then re-run the job "release dry run" of the pull request. A pull request from a fork cannot meet the rule, because the dry run needs a branch of this repository. The job "Version commit" of a release runs the check `dry-run` again, so a change that reached `main` without a dry run stops the release until a dry run tested it. Do not make "release dry run" a required check of `main`: the release moves `main` to its version commit, which has no result of the check.
5. **Only GitHub Actions with Microsoft Entra ID.** Only the job "Publish to the Visual Studio Marketplace" publishes, signed in with the app registration of [Marketplace setup](#marketplace-setup). No personal access token exists for the publisher. Nobody uploads a VSIX on the publisher management page or runs `vsce publish`, `unpublish`, `delete-publisher` or `login` on a computer. The check `rules` reads the workflows, the actions, the npm scripts and every file of `scripts/` except the checks and their test. It fails when a file other than `release.yml` runs `vsce publish`, when `vsce publish` or `vsce verify-pat` runs without `--azure-credential`, when a file uses `VSCE_PAT`, `vsce login` or the option `-p` or `--pat` of vsce, or when an npm script runs `vsce publish`, `vsce unpublish`, `vsce delete-publisher` or `vsce login`. In a file of JavaScript or TypeScript, it also reads the argument lists that run vsce and the calls of `publish`, `publishVSIX` and `unpublishVSIX` of the vsce API. No check sees the website or another computer, so there everyone must follow the rule without a check.

**Checks before the tag.** Some checks stop a release before the tag for the
known causes of a failed publish. So the job "Check the Marketplace" signs in
like the publish job and checks with `vsce verify-pat --azure-credential` that
the app registration has a role on the publisher. The Marketplace refuses a
package with more than 30 tags with the error "You exceeded the number of
allowed tags of 30", which the Microsoft publishing guide names. So the job
"Check the package" fails when the package has more than 30 tags, also in a
dry run. It counts every tag in the element `<Tags>` of the package: the
keywords of `package.json` and the tags that vsce adds, for example the
language of each `onLanguage` event in `activationEvents`. Because vsce adds
tags, the check can refuse a package with fewer than 30 keywords. In a dry
run, "Check the Marketplace" does not run: a dry run also starts from other
branches, and the environment `marketplace` admits only `main` and the tags.
The release does not check whether the Marketplace lists the extension. When
the publish job fails, the tag and the GitHub release stay: remove the cause,
then choose "Re-run failed jobs" on the run; the re-run publishes the VSIX of
the GitHub release. GitHub allows a re-run only within 30 days of the run;
after that, only a new version can reach the Marketplace.

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
