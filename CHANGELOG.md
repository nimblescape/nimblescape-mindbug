# Change log

Each section lists the changes of one released version. The release workflow
takes the section of a version as the notes of its GitHub release.

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
