# nimblescape Mindbug

See the memory of your TypeScript program while you debug it: the stack and the heap, as a diagram next to the code.

Mindbug is a VS Code extension for teaching. It shows the **stack**, with one scope for each function call and its local variables, and the **heap**, with the objects and arrays that the variables point to. Arrows go from the variables to the objects. Mindbug works like [Python Tutor](https://pythontutor.com), but inside VS Code, with its normal debugger. It runs the program with [Deno](https://deno.com) or [Node.js](https://nodejs.org).

![Mindbug in VS Code, step by step: F5 starts the program, the call of createBook adds a scope with the parameters title and pages to the stack, new Book creates an object on the heap, after the return the variable myBook of the Global scope points to the object, and after myBook = null the object is gone; then the step history shows the steps 5 to 2 again; a blue band above the window names each scene, and a label at the bottom names each pressed key and its command](https://raw.githubusercontent.com/nimblescape/nimblescape-mindbug/main/docs/images/return-object.gif)

The animation steps through the example [return-object.ts](https://github.com/nimblescape/nimblescape-mindbug/blob/main/examples/return-object.ts) and then goes back through the step history.

## What the extension does on your computer

- **When it works.** Mindbug starts when a debug session starts in VS Code, or when you run one of its commands. Before that, it does nothing. It does not run in VS Code for the Web.
- **Runtimes.** **Run with Mindbug** and a launch configuration of type `mindbug` first run `deno --version` or `node --version` (the programs of the settings `nimblescape.mindbug.denoPath` and `nimblescape.mindbug.nodePath`) to find a runtime. Then the JavaScript debugger of VS Code starts your TypeScript file with Deno (`deno run --inspect-brk=127.0.0.1:9229 --allow-all`) or with Node.js 22.7 or newer (`node --inspect-brk=127.0.0.1:9229 --experimental-transform-types`), in the workspace folder, and connects to it on your computer only (`127.0.0.1`, port of the setting `nimblescape.mindbug.inspectPort`). With `--allow-all`, Deno gives your program all the rights of your user, as Node.js does: a program that you run with Mindbug is code that you run, so run only programs that you trust. **Run with Mindbug** saves the file before it starts it.
- **Code in your program.** At each pause of a debug session of the JavaScript debugger, also of one that Mindbug did not start, Mindbug reads the variables of the scopes from the JavaScript engine (V8), through the connection that the debugger gives, and runs a small helper in the paused program with their values. The helper reads the objects that the values reach, and gives each object a number that stays the same from step to step. It adds one hidden global variable, `__mindbug`, to the program, calls no getter, and changes no variable and no object of the program. Only an object that is a `Proxy` runs code of the program when the helper reads it.
- **Files and data.** Mindbug changes no file of your workspace, except the save of **Run with Mindbug**. It keeps the steps of the step history in the memory of VS Code, until the next debug session starts or the debug session restarts. The four switches of the view are settings: a click on a switch changes its setting, and VS Code saves it in your user settings. Mindbug writes nothing else to the disk, so an uninstall leaves only your settings of Mindbug and a `launch.json` file with a configuration of type `mindbug`; VS Code then shows that it does not know the type.
- **Network.** Mindbug connects only to the JavaScript debugger of VS Code, at the local address (`127.0.0.1`) that the debugger gives it. The debugger connects to the runtime on your computer. Deno downloads the modules that your program imports from the web (for example `npm:` and `jsr:` imports), as `deno run` always does. Mindbug collects no telemetry.
- **Restricted Mode and virtual workspaces.** Mindbug does not run in Restricted Mode, because VS Code debugs a program only in a trusted workspace, and not in virtual workspaces, because Deno and Node.js run a file on the disk.

[Security](https://github.com/nimblescape/nimblescape-mindbug/blob/main/docs/security.md#what-mindbug-does-on-your-computer) describes each step and where its protection ends.

## Features

- **Stack and heap.** The stack and the heap build bottom up: the Global scope and its objects are at the bottom, and each function call adds a scope, with its objects, on top. A triangle at the left points to the scope that runs.
- **UML notation.** Objects are UML objects (`:Person`, with one line for each attribute), and arrays are rows of indexed cells.
- **Classes.** The classes are at the top of the heap, with their static variables, attributes, methods and superclass, because in JavaScript a class is also an object on the heap.
- **Block scopes.** A block `{ … }` with its own variables, such as the body of a `for` loop or of an `if`, is a part inside the box of its scope, named after its statement: "for scope", "if scope", and so on. The editor marks each block scope of the line where the program is in the color of its part. When a variable of a block has the name of a variable around the block, the view shows both.
- **Aliasing.** Two arrows to one object show that two variables point to the same object.
- **Changes.** Everything that changed in the last step has a yellow background.
- **Step history.** Go back to an earlier step. The view then shows the memory of that step, and the editor marks its line with the text "Mindbug: step 8 of 14" at its end.
- **Any runtime.** The view shows every debug session of the JavaScript debugger of VS Code, also one that a launch configuration of type `node` starts.
- **Themes.** The view follows the light, dark and high contrast themes of VS Code.

## Requirements

- VS Code 1.125 or later. Mindbug uses the JavaScript debugger that is part of VS Code.
- [Deno 2](https://docs.deno.com/runtime/getting_started/installation/), or [Node.js](https://nodejs.org) 22.7 or newer. Mindbug takes Deno when it is installed, else Node.js.

## Usage

1. Open a TypeScript file.
2. Run the command **Run with Mindbug** (Command Palette, or the button at the top right of the editor).
3. The program pauses at its first line, and the **Mindbug** view opens next to the code.
4. Use **Step Over** (F10) and **Step Into** (F11) of the debugger. The view changes at each step.

Without a `launch.json` file, F5 in a TypeScript file also offers **Mindbug**. The [user guide](https://github.com/nimblescape/nimblescape-mindbug/blob/main/docs/guide.md#launch-configurations) explains the launch configurations of type `mindbug`, and the [examples](https://github.com/nimblescape/nimblescape-mindbug/tree/main/examples) are seven small programs to start with.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `nimblescape.mindbug.runtime` | `auto` | The runtime: `auto` (Deno when it is installed, else Node.js), `deno` or `node`. |
| `nimblescape.mindbug.denoPath` | `deno` | Path to the Deno program. |
| `nimblescape.mindbug.nodePath` | `node` | Path to Node.js 22.7 or newer. |
| `nimblescape.mindbug.inspectPort` | `9229` | Port on which Deno or Node.js waits for the debugger. |
| `nimblescape.mindbug.stopOnEntry` | `true` | Pause at the first line of the program. |
| `nimblescape.mindbug.openAutomatically` | `true` | Open the Mindbug view at the first pause of a debug session. |
| `nimblescape.mindbug.showClasses` | `true` | Show the classes at the top of the heap (the switch **Show classes** of the view). |
| `nimblescape.mindbug.showFunctions` | `false` | Show functions, and the variables that hold functions or classes (the switch **Show functions**). |
| `nimblescape.mindbug.showIds` | `true` | Show the number of each object (the switch **Show ids**). |
| `nimblescape.mindbug.showUninitialized` | `false` | Show the variables whose line has not run yet, as "uninitialized": a `let`, `const` or `class` before its line (the switch **Show uninitialized**). |
| `nimblescape.mindbug.maxHistorySteps` | `500` | Number of steps that the view keeps for the step history. |
| `nimblescape.mindbug.maxObjects` | `300` | Number of heap objects that are read per scope. |
| `nimblescape.mindbug.maxArrayItems` | `100` | Number of array items, set members and map entries per object. |
| `nimblescape.mindbug.maxStringLength` | `200` | Number of characters per string. |

All commands, settings and details are in the [user guide](https://github.com/nimblescape/nimblescape-mindbug/blob/main/docs/guide.md).

---

[Change log](https://github.com/nimblescape/nimblescape-mindbug/blob/main/CHANGELOG.md) · [Contributing](https://github.com/nimblescape/nimblescape-mindbug/blob/main/CONTRIBUTING.md) · [User guide](https://github.com/nimblescape/nimblescape-mindbug/blob/main/docs/guide.md) · [Support](https://github.com/nimblescape/nimblescape-mindbug/blob/main/SUPPORT.md) · [Issues](https://github.com/nimblescape/nimblescape-mindbug/issues) · [Source](https://github.com/nimblescape/nimblescape-mindbug)

© 2026 Hannes Stauss (scalarion@nimblescape.com) · [MIT License](https://github.com/nimblescape/nimblescape-mindbug/blob/main/LICENSE).
