# Security model

This document describes what Mindbug does on your computer, what it protects, how, and where its protection ends. The user guide is [guide.md](guide.md); how the parts work together is in [architecture.md](architecture.md).

## What Mindbug does on your computer

The README and the Marketplace page list these behaviors at the top. Each item links to its details.

- **When it works.** Mindbug activates when a debug session starts in VS Code (`onDebug`), or when you run one of its commands. Before that, it does nothing. It does not run in Restricted Mode (see [Workspace trust](#workspace-trust)).
- **The command `ts`.** **Run with Mindbug** and a launch configuration of type `mindbug` start your TypeScript file with the debug type `ts` of the extension nimblescape TypeScript (`nimblescape.nimblescape-typescript`), which VS Code installs together with Mindbug, in the workspace folder. Its command `ts` checks the file, compiles it with the TypeScript compiler that VS Code uses, and runs it with Node.js in the JavaScript debugger of VS Code, which connects to Node.js on `127.0.0.1`. Mindbug passes no option to Node.js and runs no code of its own before the first line of the program. The extension nimblescape TypeScript describes what `ts` does: which compiler and which Node.js it runs, and which files it writes. **Run with Mindbug** saves the file before it starts it. See [The program that you run](#the-program-that-you-run).
- **Code in your program.** At each pause of a debug session of the JavaScript debugger for Node.js (the debug types `pwa-node`, `node` and `node-terminal`), also of one that Mindbug did not start, Mindbug reads the variables of the scopes and the code of the program from V8, the JavaScript engine of Node.js, with the Chrome DevTools Protocol, which the debugger sends on to V8. Then it runs its helper in the paused program with the values of the variables, with the request `Runtime.callFunctionOn`. The helper adds the hidden global `__mindbug`, reads the objects that the values reach, calls no getter, and changes no variable and no object of the program. A `Proxy` runs its traps when the helper reads it. Mindbug sends no request to the sessions of other debuggers. See [The heap helper](#the-heap-helper).
- **Files and data.** Mindbug changes no file of your workspace, except the save of **Run with Mindbug**. It keeps the steps of the step history in memory, until the next debug session starts or the debug session restarts. A click on a switch of the view changes the user setting of that switch, which VS Code saves in its user settings; Mindbug writes nothing else to the disk and does not change the settings of a workspace. See [Stored data](#stored-data).
- **Network.** Mindbug connects only to the JavaScript debugger of VS Code: to the WebSocket server on `127.0.0.1` whose port the debugger gives with its request `requestCDPProxy`, one connection for each debug session. The debugger connects to Node.js on `127.0.0.1`. Mindbug collects no telemetry. See [The view](#the-view).

## The trust model

**A program that you run with Mindbug is code that you run.** Mindbug is a teaching tool, not a sandbox. The program runs with the rights of your user, as when you run `node` in a terminal. It can:

- read, change and delete your files;
- connect to any address of the internet and of your local network;
- start other programs;
- read the environment variables of VS Code, which can hold tokens.

Run only programs that you trust: your own programs, and the examples of a course whose source you can read. Mindbug adds no right that the program would not have without Mindbug, and it removes none.

## Trust boundaries

| Part | Runs as | Trusts |
| --- | --- | --- |
| The extension (`dist/extension.js`) | Your user, in the extension host of VS Code | VS Code, the JavaScript debugger and the address of its WebSocket server, and the snapshot data that the helper returns, which it only parses as JSON |
| The debug type `ts` of nimblescape TypeScript | Your user, in the extension host | The configuration that Mindbug or `launch.json` gives it |
| The JavaScript debugger | Your user, in the extension host | The configuration that the debug type `ts` or `launch.json` gives it |
| The command `ts` with the TypeScript compiler, and Node.js with your program and the helper | Your user, in their own processes | Nothing: it is your program |
| The view (`dist/webview.js`) | The webview of VS Code, without access to files or the network | The messages of the extension |

The data of a snapshot comes from the program, so the extension and the view treat it as text from a stranger: the extension only parses it as JSON, and the view writes every name and value with `textContent`, never as HTML. A program that replaces `globalThis.__mindbug` with its own object can make the view show wrong values, but it cannot run code in the view or in the extension.

## Workspace trust

VS Code debugs a program only in a workspace that you trust, because a `launch.json` file or the settings of a workspace can name any program. Mindbug declares `untrustedWorkspaces: false` in its manifest: in Restricted Mode, VS Code does not activate it. The files of a workspace, for example a TypeScript package in its `node_modules` folder, can decide which code the command `ts` runs as the compiler (see nimblescape TypeScript), as its `launch.json` can decide which program runs. Trust a workspace only when you trust its files.

## The program that you run

- **No permissions.** Mindbug adds no limit to the rights of the program: it has all the rights of your user. Run a program that you do not trust in a terminal with only the permissions it needs, not with Mindbug.
- **The inspector port.** While the program runs, Node.js waits for the debugger on a port of `127.0.0.1`. Only programs of your computer can connect to this address, but every program of your computer can, also the programs of other users of the same computer. A program that connects to the port can run code in your program, with your rights, while it runs. On a computer that other people use at the same time, stop the program when you do not debug it. The port is closed when the program ends.
- **TypeScript.** The command `ts` compiles the program before it runs, and the compiler runs with your rights. Mindbug itself loads no compiler and installs nothing.
- **No options of Node.js.** Mindbug passes no option to Node.js and turns off no warning of Node.js.

## The heap helper

The helper is the function `installHeapWalker` of [src/heapWalker.ts](../src/heapWalker.ts). Its text runs in your program with the request `Runtime.callFunctionOn`, which the JavaScript debugger sends on to V8, as a function that runs in the global scope of the program. Mindbug gives it the values of the variables that V8 lists in the scopes of the paused program; the helper reads no variable by its name.

Mindbug also reads the code of the scripts of the program from V8 (`Debugger.getScriptSource`), to name each block scope after its statement. It only reads the code.

What it does:

- It defines one global property, `__mindbug`, which is not enumerable, so `Object.keys(globalThis)` and `for … in` do not show it; `Object.getOwnPropertyNames(globalThis)` does.
- It gives each object a number in a `WeakMap`, so that it keeps no object alive: the garbage collection of the program works as without Mindbug.

What it does not do:

- It calls no getter, no setter, and no `toString`, `valueOf`, `toJSON` or `Symbol.toPrimitive` of the program. It reads property descriptors, and it uses the built-in functions that it saved at its install, so that a program that replaces a built-in method later, for example `Array.prototype.push`, the iterator of arrays or `Map.prototype.entries`, or that adds `Object.prototype.toJSON`, does not change what it reads, and none of these functions of the program runs. A unit test checks this.
- It changes no variable, no attribute and no array of the program.
- It runs only while the program is paused, when the debugger asks for it.

Where its protection ends:

- A `Proxy` runs the traps of its handler, for example `ownKeys` and `getOwnPropertyDescriptor`, when the helper reads it. JavaScript offers no way to read a proxy without them.
- To read the text of a function or a class (its signature, and the attributes that a class declares), the helper uses the methods of strings and regular expressions as the program has them. A program that replaces `String.prototype.slice`, for example, runs its own function there.
- A program that adds a getter or a setter for a name such as `items` or `0` to `Object.prototype` or `Array.prototype` can see the objects that the helper builds for its result.
- A program can detect the helper: it can read `globalThis.__mindbug`, and its timing changes while the debugger reads the memory. A program that behaves differently when it is debugged is not a program to learn with.

## The view

The view is a webview of VS Code. Its content security policy (`src/webviewHtml.ts`) allows only the script of the extension with the nonce of the page (128 random bits from the random generator for cryptography of Node.js), and the styles and images of the extension (`default-src 'none'`). It loads nothing from the network, and it reaches no file: it gets the snapshots from the extension as messages.

The page shows names and values of the debugged program, so the extension treats its messages as untrusted: it checks each message (`fromWebview` in `src/model.ts`) and ignores a message of another type or with a value of the wrong type. The view sends four kinds of messages:

- `ready`, when the page has loaded.
- `viewStep` and `openLocation`, which carry only the number of a step and of a frame of that step, never a file. The extension takes the file and the line from its own step history and opens that file as a text document; it runs nothing. A step or a frame that the history does not have opens nothing, so the page cannot open any other file.
- `viewOption`, which carries the name and the value of a switch of the view after a click. The extension saves only the values `true` and `false` of the six user settings of the switches (`nimblescape.mindbug.showClasses`, `showFunctions`, `showIds`, `showUninitialized`, `showScopeFrames` and `stopOnEntry`), and ignores any other name or value.

## Stored data

| Data | Where | How long |
| --- | --- | --- |
| The steps of the step history | The memory of the extension host and of the view | Until the next debug session starts, the debug session restarts, or VS Code closes |
| The settings of Mindbug, also the six switches of the toolbar of the view | The settings of VS Code (`settings.json`), when you change them or click a switch | Until you change them |

Mindbug itself writes no file: VS Code saves the user settings, also the switches of the view. The command `ts` writes the compiled program (see nimblescape TypeScript). Mindbug uses neither `globalState` nor `workspaceState` of VS Code, stores no secret, and sends nothing to any address.

## Known limits

- Mindbug cannot make a program safe. It runs every program with all the rights of your user (see [The trust model](#the-trust-model)).
- The inspector port is open to the other programs of your computer while the program runs (see [The program that you run](#the-program-that-you-run)).
- A `Proxy` runs code of the program when the helper reads it (see [The heap helper](#the-heap-helper)).
- Mindbug follows every debug session of the JavaScript debugger for Node.js, also one that another extension or a JavaScript Debug Terminal starts, and runs its helper there at each pause, also while the view is closed, so that the view has the whole step history when it opens. To debug a program without the helper, disable Mindbug for the workspace in the Extensions view.

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](../LICENSE).
