# Mindbug

Mindbug is a Visual Studio Code extension for teaching. It shows the memory of a TypeScript program
while you debug it: the **stack** with one scope for each function call, and the **heap** with the
objects and arrays that the variables point to. It works like [Python Tutor](https://pythontutor.com),
but inside VS Code, with the normal debugger, and with [Deno](https://deno.com) as the runtime.

![The Mindbug view next to the code: scopes on the stack on the left, arrays on the heap on the right](docs/images/stack-and-heap.png)

## What the Mindbug view shows

- **STACK** (blue area): one scope for each function call, with its local variables. The stack
  builds bottom up: the Global scope is at the bottom, and each function call adds a scope on top.
  The top scope is the function that runs: a triangle at its left points to it. The triangle is
  yellow at the current step and green at an earlier step, as the arrow of the debugger in the
  editor. Each variable is a box. A number, a string or a boolean is written in the box.
- **HEAP** (yellow area): objects and arrays. A variable that holds an object stores only *where*
  the object is. The view draws this as an arrow from the variable to the object. Two arrows to the
  same object mean that two variables point to the same object. The heap also builds bottom up: the
  objects of the Global scope are at the bottom, next to the Global scope, and the objects of each
  newer function call are above them.
- **Objects** use UML object notation: `:Person` (underlined) in the head, and one line
  `name = value` for each attribute.
- **Arrays** are a row of cells, with the index at the top left of each cell.
- **Classes** are at the top of the heap, because in JavaScript a class is also an object on the
  heap. A class box shows the **static variables** (class variables) with their values, underlined
  as in UML, the attributes that each object gets, and the methods. A subclass shows
  "extends" and the UML arrow to its superclass. Move the mouse over an object to see a dashed arrow
  to the class it was made from.
- **Changes**: everything that changed in the last step has a yellow background.

![Classes with static variables, objects made from them, and the dashed arrow from an object to its class](docs/images/classes.png)

### Step history

Each time the program pauses (a breakpoint or a step), the view saves a step. Use the step list,
the slider or the Left and Right arrow keys to go back to an earlier step. The view then shows the
memory as it was at that step. The editor shows the line where the program was at that step, also
when that line is in another file. It marks the line as the debugger does when you select a function
call in its Call Stack view: a green arrow and a green line. The yellow line of the debugger stays the current position
of the program. The line is in your TypeScript file, because VS Code's debugger reads Deno's source
map. Select **Show current step** (or press End) to go back to the newest step.

![An earlier step in the dark theme: step 8 is selected in the step list](docs/images/history-dark.png)

The view follows the color theme of VS Code: light, dark and high contrast.

## Requirements

- VS Code 1.90 or newer. The extension uses the JavaScript debugger that is built into VS Code.
- [Deno 2](https://docs.deno.com/runtime/getting_started/installation/) on the `PATH`, or the
  setting `nimblescape.mindbug.denoPath` pointing to the Deno program.

## How to use it

1. Open a TypeScript file.
2. Run the command **Run with Mindbug** (Command Palette, or the button at the top right of the
   editor).
3. The program pauses at its first line, and the **Mindbug** view opens next to the code.
4. Use **Step Over** (F10) and **Step Into** (F11) of the debugger. The view changes at each step.

You can also use your own launch configuration (`.vscode/launch.json`). In `launch.json`, select
**Add Configuration…** and then **Mindbug: Debug a TypeScript file with Deno**. The view opens at
the first pause of any JavaScript or TypeScript debug session. The folder [examples](examples) has
three small programs and a `launch.json`.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `nimblescape.mindbug.denoPath` | `deno` | Path to the Deno program. |
| `nimblescape.mindbug.inspectPort` | `9229` | Port on which Deno waits for the debugger. |
| `nimblescape.mindbug.stopOnEntry` | `true` | Pause at the first line of the program. |
| `nimblescape.mindbug.openAutomatically` | `true` | Open the Mindbug view at the first pause of a debug session. |
| `nimblescape.mindbug.maxHistorySteps` | `500` | Number of steps that the view keeps for the step history. |
| `nimblescape.mindbug.maxObjects` | `300` | Number of heap objects that are read per scope. |
| `nimblescape.mindbug.maxArrayItems` | `100` | Number of array items, set members and map entries per object. |
| `nimblescape.mindbug.maxStringLength` | `200` | Number of characters per string. |

The toolbar of the view has three switches: **Show classes**, **Show functions** (functions, and the
variables that hold functions or classes) and **Show ids** (the object ids).

## How it works

The Debug Adapter Protocol does not tell whether two variables point to the same object. So, at each
pause, the extension runs a small helper inside the paused program (through the debugger's
`evaluate` request). The helper gives each object an id that stays the same from step to step, and
describes the objects that the variables can reach. It does not call getters, so reading the memory
does not change the program. The code is in [src/heapWalker.ts](src/heapWalker.ts) and
[src/snapshot.ts](src/snapshot.ts).

Limits:

- Private fields (`#name`) are not shown, because JavaScript does not allow other code to read them.
- Getters are shown as `get`, not with their value.
- Only scopes up to the first `await` are shown. The function calls before an `await` are not on
  the stack any more.

## Development

The npm scripts are the same as in the other nimblescape extensions. Node is the version in
[.node-version](.node-version).

```sh
npm install
npm run build            # builds dist/ (npm run watch: builds again after each change)
npm run typecheck
npm test                 # unit tests (vitest)
npm run test:deno        # tests against a real Deno program (needs Deno, or DENO_PATH)
npm run test:render      # screenshots of the view in three themes (test/render/output)
npm run test:vscode      # tests in a real VS Code (downloads VS Code; use xvfb-run on Linux)
npm run package          # builds nimblescape-mindbug-<version>.vsix (minified, without source maps)
npm run install-local    # builds the .vsix and installs it into the VS Code of this computer
npm run uninstall-local  # removes it from the VS Code of this computer (also the old ids nimblescape.heap-stack and nimblescape.mindbug)
```

`npm run record` records the example programs step by step with Deno into
`test/render/snapshots`, which the screenshot test uses.

## License

[MIT](LICENSE)
