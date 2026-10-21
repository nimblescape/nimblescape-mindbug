# Mindbug user guide

The complete guide to Mindbug. The short overview is the [README](../README.md); how Mindbug works inside is in [architecture.md](architecture.md), and the security model in [security.md](security.md).

**Contents:** [Requirements](#requirements) · [Install](#install) · [First steps](#first-steps) · [The Mindbug view](#the-mindbug-view) · [Step history](#step-history) · [Commands](#commands) · [Launch configurations](#launch-configurations) · [Runtimes](#runtimes) · [Settings](#settings) · [Examples](#examples) · [Known limits](#known-limits) · [Troubleshooting](#troubleshooting) · [Uninstall](#uninstall) · [Build from source](#build-from-source)

## Requirements

- Visual Studio Code 1.125 or later. Mindbug uses the JavaScript debugger that is part of VS Code (`ms-vscode.js-debug`); it needs no other extension.
- One of these runtimes:
  - [Deno 2](https://docs.deno.com/runtime/getting_started/installation/), on the `PATH` or at the path of the setting `nimblescape.mindbug.denoPath`.
  - [Node.js](https://nodejs.org) 22.7 or newer, on the `PATH` or at the path of the setting `nimblescape.mindbug.nodePath`. Node.js runs a TypeScript file from version 22.7 on, with the option `--experimental-transform-types`.
- A trusted workspace. VS Code debugs a program only in a workspace that you trust, so Mindbug does not run in Restricted Mode.

## Install

Install **nimblescape Mindbug** from the Visual Studio Marketplace: search for "Mindbug" in the Extensions view of VS Code, or run:

```sh
code --install-extension nimblescape.nimblescape-mindbug
```

To install a package file (`.vsix`), for example from a [GitHub release](https://github.com/nimblescape/nimblescape-mindbug/releases), run `code --install-extension nimblescape-mindbug-<version>.vsix`, or select **Install from VSIX…** in the **…** menu of the Extensions view.

## First steps

1. Open a folder with a TypeScript file, for example the folder [examples](../examples) of this repository.
2. Open the TypeScript file, for example [insertion-sort.ts](../examples/insertion-sort.ts).
3. Run **Run with Mindbug**: the button at the top right of the editor, or the Command Palette (`Ctrl+Shift+P`, on macOS `Cmd+Shift+P`).
4. The program pauses at its first line, and the **Mindbug** view opens next to the code.
5. Step with the debugger: **Step Over** (F10), **Step Into** (F11), **Step Out** (Shift+F11) and **Continue** (F5). The view shows the memory after each step.

A breakpoint (F9, or a click left of the line number) pauses the program at that line, and the view shows the memory there.

## The Mindbug view

The view has two areas: the **STACK** on the left and the **HEAP** on the right.

### Stack

- The stack has one **scope** for each function call, with the local variables and parameters of that call. The **Global scope** holds the variables of the file.
- The stack builds bottom up: the Global scope is at the bottom, and each function call adds a scope on top. When the function returns, its scope goes away.
- The top scope is the function that runs now. A **triangle** at its left points to it: yellow at the current step, and green at an earlier step of the [step history](#step-history), as the arrow of the debugger in the editor.
- The variables of a scope also build bottom up, in the order of their declarations in the file: the first variable of the function, its first parameter, is at the bottom, and each later variable is above it. The variables of a block, for example of the body of a loop, are above the variables of the function. The variables of an outer function that a closure uses are below the own variables.
- Each variable is a box. A number, a string, a boolean, `null` or `undefined` is written in the box. A `let`, `const` or `class` whose line has not run yet shows "uninitialized".
- When you step to the end of a function, its scope shows **Return value**, the value that the function gives back. A constructor shows no return value: `new` gives the new object, not a value of the constructor.
- A variable that holds an object or an array stores only *where* the object is on the heap. The view draws this as an arrow from the variable to the object.

### Heap

- The heap holds the **objects** and **arrays** that the variables point to, also the objects that these objects point to.
- The heap builds bottom up too: the objects of the Global scope are at the bottom, next to the Global scope, and the objects of each newer function call are above them. An object belongs to the oldest scope with a variable that points to it.
- An object that no variable reaches any more goes away from the view. JavaScript frees its memory later (garbage collection).
- **Two arrows to the same object** mean that two variables point to the same object: a change through one variable is a change of the object that the other variable sees.
- Objects use **UML object notation**: `:Person` (underlined) in the head, and one line `name = value` for each attribute.
- Arrays are a row of cells, with the index at the top left of each cell. Maps and sets are tables.
- **Classes** are at the top of the heap, because in JavaScript a class is also an object. A class box shows the **static variables** (class variables) with their values, underlined as in UML, the attributes that each object gets, and the methods. A subclass shows "extends" and the UML arrow to its superclass. Move the mouse over an object to see a dashed arrow to its class.

![Classes with static variables, objects made from them, and the dashed arrow from an object to its class](https://raw.githubusercontent.com/nimblescape/nimblescape-mindbug/main/docs/images/classes.png)

### Changes

Everything that changed in the last step has a yellow background: a new or changed variable, a new object, or a changed attribute or array cell.

### Toolbar

| Switch | What it does |
| --- | --- |
| **Show classes** | Shows the classes, with their static variables, at the top of the heap. |
| **Show functions** | Shows functions, and the variables that hold functions or classes. |
| **Show ids** | Shows the number of each object, which stays the same from step to step. |

Each switch is a setting (see [Settings](#settings)). A click on a switch changes its setting, so the view has the switches again after you close it and after a restart of VS Code. When the settings of a workspace set a switch, they decide: a click on that switch changes the view only until you close it, because Mindbug does not change the settings of a workspace, a file of the workspace (`.vscode/settings.json`).

The view follows the color theme of VS Code: light, dark and high contrast.

## Step history

Each time the program pauses, at a breakpoint or after a step, the view saves a **step**. The step list, the slider, and the Left and Right arrow keys go back to an earlier step; Home shows the first step, and End the newest step. The view then shows the memory as it was at that step.

The editor shows the line where the program was at that step, also when that line is in another file or the file was closed. It marks the line as the debugger marks a function call that you select in its Call Stack view, with a green arrow and a green line, and writes the step at the end of the line, for example "Mindbug: step 8 of 14": the view shows step 8, and the program is at step 14. The yellow line of the debugger stays the current position of the program. **Show current step** (or End) goes back to the newest step.

![An earlier step in the dark theme: step 8 is selected in the step list](https://raw.githubusercontent.com/nimblescape/nimblescape-mindbug/main/docs/images/history-dark.png)

The view keeps the steps of the newest debug session, at most `nimblescape.mindbug.maxHistorySteps` steps; then the oldest steps go away. A new debug session starts a new history, and so does **Restart** (Ctrl+Shift+F5) of the debugger: the steps of the earlier run go away, and the steps of the new run count from 1.

## Commands

| Command | Where | What it does |
| --- | --- | --- |
| **Run with Mindbug** | Command Palette and the button at the top right of a TypeScript editor, when no program runs | Saves the file and starts it with Deno or Node.js in the debugger, as a launch configuration of type `mindbug` does. |
| **Open Mindbug** | The button at the top right of the editor while a program runs in the JavaScript debugger | Opens the Mindbug view, for example after you closed it. |

The view also opens by itself at the first pause of a debug session, unless the setting `nimblescape.mindbug.openAutomatically` is off.

## Launch configurations

The debug type `mindbug` starts a TypeScript file from a launch configuration (`.vscode/launch.json`), in the same way as **Run with Mindbug**. In `launch.json`, select **Add Configuration…** and then **Mindbug: Run a TypeScript file**:

```json
{
  "type": "mindbug",
  "request": "launch",
  "name": "Mindbug: current file",
  "program": "${file}"
}
```

| Attribute | Default | What it does |
| --- | --- | --- |
| `program` | `${file}` (the file of the active editor) | The TypeScript file to run. |
| `runtime` | the setting `nimblescape.mindbug.runtime` | `auto`, `deno` or `node`. |
| `cwd` | the workspace folder | The folder in which the program runs. |
| `stopOnEntry` | the setting `nimblescape.mindbug.stopOnEntry` | Pause at the first line of the program. |

Without a `launch.json` file, press F5 in a TypeScript file and select **Mindbug**. The list **Run and Debug** also offers **Mindbug: current file**.

The view also works with a launch configuration of type `node` of the JavaScript debugger, and with the JavaScript Debug Terminal: it follows every debug session of the JavaScript debugger for Node.js and Deno. The [launch.json](../examples/.vscode/launch.json) of the examples has a configuration of type `mindbug` and one of type `node`.

## Runtimes

With the runtime `auto` (the default), Mindbug takes Deno when `deno --version` runs, else Node.js when `node --version` shows version 22.7 or newer. With `deno` or `node`, it takes only that runtime. When it finds no runtime, a message says what is missing, and the program does not start.

| Runtime | Command that the debugger runs |
| --- | --- |
| Deno | `deno run --inspect-brk=127.0.0.1:<port> --allow-all <file>` |
| Node.js | `node --inspect-brk=127.0.0.1:<port> --experimental-transform-types --disable-warning=ExperimentalWarning <file>` |

`<port>` is the setting `nimblescape.mindbug.inspectPort` (9229). With `stopOnEntry` off, the option is `--inspect-wait` instead of `--inspect-brk`: the program waits for the debugger, but does not pause at its first line. The runtime waits for the debugger on `127.0.0.1` only, so no other computer can connect to it. The JavaScript debugger reads the source map of the runtime, so the debugger and the view show the lines of your TypeScript file.

With `--allow-all`, Deno gives the program all the rights of your user, as Node.js does: it can read and write files, use the network and start other programs. See [Security](security.md#the-program-that-you-run).

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `nimblescape.mindbug.runtime` | `auto` | The runtime of **Run with Mindbug** and of a launch configuration of type `mindbug`: `auto` (Deno when it is installed, else Node.js), `deno` or `node`. The attribute `runtime` of a launch configuration wins over this setting. |
| `nimblescape.mindbug.denoPath` | `deno` | Path to the Deno program. The default works when Deno is on the `PATH`. |
| `nimblescape.mindbug.nodePath` | `node` | Path to Node.js 22.7 or newer. The default works when Node.js is on the `PATH`. |
| `nimblescape.mindbug.inspectPort` | `9229` | Port on which Deno or Node.js waits for the debugger. Change it when another program uses port 9229. |
| `nimblescape.mindbug.stopOnEntry` | `true` | Pause at the first line of the program, so that you can step from the start. |
| `nimblescape.mindbug.openAutomatically` | `true` | Open the Mindbug view at the first pause of a debug session. |
| `nimblescape.mindbug.showClasses` | `true` | Show the classes, with their static variables, at the top of the heap. The switch **Show classes** of the view changes it. |
| `nimblescape.mindbug.showFunctions` | `false` | Show functions, and the variables that hold functions or classes. The switch **Show functions** of the view changes it. |
| `nimblescape.mindbug.showIds` | `true` | Show the number of each object. The switch **Show ids** of the view changes it. |
| `nimblescape.mindbug.maxHistorySteps` | `500` | Number of steps that the view keeps for the step history (1 to 5000). |
| `nimblescape.mindbug.maxObjects` | `300` | Number of heap objects that are read per scope (10 to 5000). |
| `nimblescape.mindbug.maxArrayItems` | `100` | Number of array items, set members and map entries that are shown per object (5 to 2000). |
| `nimblescape.mindbug.maxStringLength` | `200` | Number of characters that are shown per string (10 to 10000). |

A higher limit shows more of a large program, and makes each step slower, because the helper reads more objects at each pause.

## Examples

The folder [examples](../examples) has five small programs:

- [return-object.ts](../examples/return-object.ts): a function creates one object and returns it. The call adds a scope with the parameters title and pages to the stack. The object stays on the heap after the return, because the variable myBook of the Global scope points to it, and it goes away when myBook is set to `null`. The animation at the top of the [README](../README.md) steps through this example.
- [insertion-sort.ts](../examples/insertion-sort.ts): two variables point to the same array, and the function changes the array on the heap.
- [people.ts](../examples/people.ts): classes, a static variable, constructors, a subclass and methods.
- [linked-list.ts](../examples/linked-list.ts): objects that point to each other.
- [call-stack.ts](../examples/call-stack.ts): three functions on the stack at the same time, with objects of the classes Item, Discount and Bill. The Discount object that the inner function creates does not survive its call; the Bill object that the middle function creates survives the call of the inner function and is still there in the Global scope at the end.

![Four scopes on the stack, lineTotal on top of makeBill, checkout and the Global scope; the Discount object of lineTotal above the Bill object of makeBill and the objects of the Global scope](https://raw.githubusercontent.com/nimblescape/nimblescape-mindbug/main/docs/images/call-stack.png)

## Known limits

- **Private fields** (`#name`) are not shown, because JavaScript does not allow other code to read them.
- **Getters** are shown as `get`, not with their value, because calling a getter runs code of the program.
- **A `Proxy`** runs the traps of its handler when the helper reads it: there is no way to read a proxy without them.
- **`await`**: after an `await`, the function calls before it are no longer on the stack, so the view shows only the scopes up to the first `await`.
- **Large programs**: the view reads at most `nimblescape.mindbug.maxObjects` objects per scope; an object after that shows "… not loaded". It shows at most `nimblescape.mindbug.maxArrayItems` items of an array, a set or a map, and at most `nimblescape.mindbug.maxStringLength` characters of a string.
- **Other languages**: the view follows only the JavaScript debugger for Node.js and Deno. It shows nothing for a program in a browser, or for other debuggers such as Python.
- **Node.js 22 and the set-up of fields**: when the program pauses in the scope "(set up fields)" of a class that also has a static variable, Node.js 22 stops with a fatal error of V8 as soon as the debugger runs code there. Mindbug runs no code in that scope, but the debugger of VS Code can, for example for a watch expression or when you move the mouse over a variable in the editor. Node.js 24 and Deno do not have this fault.
- **Node.js and breakpoints**: with Node.js, the program can miss the pause at its first line and pause first at a breakpoint. This happens when the line number of a breakpoint equals the line of the first statement in the code that Node.js generates from the TypeScript file, because of a fault of the JavaScript debugger of VS Code. Move the breakpoint to another line, or set it after the program has paused at its first line.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "Mindbug did not find Deno" or "Mindbug needs Deno or Node.js 22.7 or newer" | Install Deno or Node.js 22.7 or newer, or set `nimblescape.mindbug.denoPath` or `nimblescape.mindbug.nodePath` to the full path of the program. Restart VS Code after an installation, so that it sees the new `PATH`. |
| The program does not start, and the Debug Console says that the address is in use | Another program uses port 9229. Set `nimblescape.mindbug.inspectPort` to another port, for example 9230. |
| The view does not open | Run **Open Mindbug** while the program is paused, or turn on `nimblescape.mindbug.openAutomatically`. |
| The view says "The memory could not be read" | The debugger did not answer a request of the helper. Step once more; when the message stays, report it (see [Support](../SUPPORT.md)) with a small program. |
| **Run with Mindbug** is missing | The button shows only in a TypeScript editor while no program runs. Check that the workspace is trusted. |

## Uninstall

Uninstall **nimblescape Mindbug** in the Extensions view of VS Code, or run `code --uninstall-extension nimblescape.nimblescape-mindbug`. Mindbug stores no data of its own on the disk; only your settings of Mindbug stay in the settings of VS Code. A launch configuration of type `mindbug` in a `launch.json` file stays; VS Code then shows that it does not know the type.

## Build from source

[CONTRIBUTING.md](../CONTRIBUTING.md) describes the files, the build, the tests and the release. In short, with Node.js of the version in `.node-version`:

```sh
npm ci --ignore-scripts
npm run package
code --install-extension nimblescape-mindbug-<version>.vsix
```

How Mindbug works inside is described in [architecture.md](architecture.md).

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](../LICENSE).
