# Change log

Each section lists the changes of one released version. The release workflow
takes the section of a version as the notes of its GitHub release.

## 0.1.6

**Block scopes.** A block `{ … }` that declares a `let`, `const` or
`class`, for example the body of a loop or of an `if`, has a scope of its
own. The view now draws it as a part inside the box of its scope, and names
it after its statement: "if scope", "while scope", "block scope", and so on.
A `for` loop with `let i` has two: the "for scope" with `i`, and inside it
the "for body scope" with the variables of its body. A block inside a block
is a part inside the part. A block around a function is no part of the
function: the variables of the block that the function uses are closure
variables of the function, like the variables of an outer function. The
line above them now says "from the enclosing scope". Before, the view put
the variables of all blocks into the box of the function.

**Two variables with the same name.** A variable of a block can have the
name of a variable around the block, as in `let a = 10; { let a = 200; }`.
The view showed only the `a` of the block. Now it shows both, each one in
its own part. Mindbug now gives the values of the variables to its helper
in the program, instead of their names.

**Return value of an object.** At the end of a function that returns an
object, "Return value" now points to the object on the heap with an arrow.
Before, it showed the name of the class as text.

**Block scopes in the editor.** While the program is paused, the editor
marks the block scopes of the line where the program is: a colored bar at
the indent of each block, and a frame around the header of a `for` loop.
Each part in the view has the same color as its mark, so you see which
code belongs to which part. The four colors are theme colors
(`nimblescape.mindbug.blockScope1` to `4`).

The new example `blocks.ts` shows block scopes, and a variable of a block
that hides a variable of the same name.

## 0.1.5

**Variables in the order of the program.** The variables of a scope build
bottom up in the order of the program. For `let bmw`, `let toyota`, `let a`
and `let b`, the Global scope shows `bmw` at the bottom, then `toyota`, `a`
and `b`. Before, the variables were in the order of their names (`a`, `b`,
`bmw`, `toyota`), and the variables of a block, for example of the body of a
loop, in the reverse order of their names: VS Code's JavaScript debugger
sorts the variables of each scope by name. Mindbug now reads the variables
from V8, the JavaScript engine of Deno and Node.js, which gives them in the
order of the program. It connects to V8 through the connection that the
JavaScript debugger gives to other extensions.

**Variables before their lines.** The new switch **Show uninitialized**
(setting `nimblescape.mindbug.showUninitialized`, off by default) shows a
`let`, `const` or `class` before its line, as "uninitialized": the variable
exists from the start of its scope, but the program cannot read it yet. A
`var` before its line shows `undefined`, as before. The new example
`var-and-let.ts` shows that a `var` is a variable of its whole function,
also when its line is inside a block.

**No step into the code of Deno.** With Deno, a step after the last line of
the program stopped in the code of Deno (`99_main.js`), and VS Code opened
that file. Step Into on `console.log` also stopped in the code of Deno
(`01_console.js`). Now a step after the last line ends the program, and the
editor stays on the file of the program. Step Into on `console.log` does not
go into the code of Deno. Mindbug tells VS Code's JavaScript debugger to
skip the files of Deno, as it already did for the files of Node.js.

**Faster steps in a remote window.** Mindbug now sends one request per step
through VS Code (the stack trace) instead of four rounds of requests. The
other requests go to V8 on the computer of the debugger, so in a GitHub
Codespace, a Dev Container or over SSH, a step waits for one request over
the network instead of four.

## 0.1.4

**Static variables of an exported class.** With Deno, a step in the set-up
of a static variable of an exported class, for example at `static count = 0`
in `export class Car`, stopped the program with "abort: Unexpected instance
type encountered". At that step, the name of the class is not initialized
yet, and V8 gives the debugger an internal value for it instead of the usual
error. The program stopped as soon as Mindbug read the type of that value.
Mindbug now shows the class in the Global scope as "uninitialized", as for a
class that is not exported, and the program goes on.

## 0.1.3

**No return value in a constructor.** When you step to the end of a
constructor, the scope of the constructor shows no return value. Before, it
showed "Return value" with `undefined`, or with the new object in a subclass,
although `new` gives the new object and not a value of the constructor. A
function still shows its return value.

**A restart starts a new step history.** **Restart** (Ctrl+Shift+F5) of the
debugger removes the steps of the earlier run, and the steps of the new run
count from 1. Before, the step history kept the steps of the earlier run, and
the new run counted on from the last step. Also, when VS Code reported the
end of the earlier run late, the view showed "The program has ended." while
the new run was paused, and left out that step.

**Step Into a constructor with Node.js 22.** Step Into on `new Person(...)`
first pauses where JavaScript sets up the fields of the new object, shown as
the scope "Person (set up fields)". When the class also has a static
variable, Node.js 22 stopped there with "Fatal error ... Check failed:
IsStringSet(*block_list)" as soon as Mindbug read the memory, and the program
ended. This is a fault of V8 in Node.js 22. Mindbug now runs no code in that
scope and shows its `this`, the new object, from the constructor.

**Faster steps.** Mindbug reads the memory of a step with fewer requests to
the debugger, and sends the requests that do not wait for each other at the
same time. This matters most in a remote window, for example a GitHub
Codespace, where each request goes over the network. In a test with a
network round trip of 50 ms, a step with one scope took 0.5 s instead of
1.1 s, and a step with four scopes 0.6 s instead of 5.5 s. Before, Mindbug
read the result of each scope in parts of 150 characters, one request after
the other.

**Variables named `i`, `t`, `e`, `o`, `r` or `n`.** The view shows the values
of variables with these names. Before, it showed a wrong value for them, for
example a function for the loop variable `i`, or "uninitialized", because the
debugger used these names itself in the code that read the variables.

## 0.1.2

**Step history.** When the view shows an earlier step, the editor writes the
step at the end of its green line, for example "Mindbug: step 8 of 14": the
view shows step 8, and the program is at step 14. Before, only the green color
told that the line was not the position of the program.

**The switches of the view are settings.** **Show classes**, **Show
functions** and **Show ids** are now the settings
`nimblescape.mindbug.showClasses`, `nimblescape.mindbug.showFunctions` and
`nimblescape.mindbug.showIds`. A click on a switch changes its setting, so the
view has the switches again after you close it and after a restart of VS
Code. Before, they went back to their defaults each time the view opened.
Mindbug changes only your user settings: when the settings of a workspace
set a switch, a click changes the view only until you close it.

## 0.1.1

**Remote windows.** The Mindbug view shows the stack and the heap also in VS
Code in the browser and in the windows of a Dev Container, SSH or WSL. Before,
it showed "The program is paused outside your own code." at every pause there,
because VS Code names the files of the remote computer with `vscode-remote://`
addresses, which Mindbug did not take as files of your program.

## 0.1.0

Initial release.

**The Mindbug view** shows the memory of a paused TypeScript program next to
the code: the stack, with one scope for each function call and its local
variables, and the heap, with the objects and arrays that the variables point
to. Arrows go from the variables to the objects, so two arrows to one object
show that two variables point to the same object. The stack, the variables of
a scope and the heap build bottom up, with the Global scope at the bottom. A
triangle at the left points to the scope that runs.

- Objects use UML object notation, and arrays are rows of indexed cells.
- The classes are at the top of the heap, with their static variables,
  attributes, methods and superclass. The mouse over an object shows a dashed
  arrow to its class.
- Everything that changed in the last step has a yellow background.
- The step history goes back to an earlier step: the view shows the memory of
  that step, and the editor marks its line as the debugger marks a selected
  stack frame.
- The view follows the light, dark and high contrast themes of VS Code.

**Run with Mindbug** and the debug type `mindbug` for `launch.json` start a
TypeScript file with Deno, or with Node.js 22.7 or newer when Deno is not
installed (setting `nimblescape.mindbug.runtime`), and pause at its first
line. The view also shows every other debug session of the JavaScript
debugger of VS Code, for example one of a launch configuration of type
`node`.

The [examples](https://github.com/nimblescape/nimblescape-mindbug/tree/main/examples)
are four small programs: insertion sort, classes with a static variable, a
linked list, and a call stack of three functions that shows which objects
survive a function call.

---

© 2026 Hannes Stauss (scalarion@nimblescape.com) ·
[MIT License](https://github.com/nimblescape/nimblescape-mindbug/blob/main/LICENSE).
