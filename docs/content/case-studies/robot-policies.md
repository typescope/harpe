+++
title = "The Robot Policy Problem"
+++

Wherever people ask robots to do things, the requests change from day to day:
restock the shelves before the store opens, or move materials across a depot.
No engineer can program every request in advance. With a language model, a person
just says what they want, and the model writes a program for that one request.
Robotics researchers call such a program a *policy*.

This page follows one of these robots: a robot cell, which is an arm, its work
table, and the fences and light curtains that guard them.

![An operator standing outside a robot cell says: line up the red parts along the top edge, biggest on the left. The AI writes a program for it, and the program runs in the cell. The cell is an arm, its work table, a fence and a light curtain on the operator's side. The arm is placing red parts in a row on the table, biggest on the left.](/img/robot-policies-cell.svg)

## The problem

An operator at the cell tells the arm:

> Line up the red parts along the top edge, biggest on the left, and leave a
> finger's width between them.

Ten minutes later the request is "which part is closest to me?", and after that
"bring the blue parts to me". Each request is new, each program runs once, and
the operator expects the arm to move now.

For the first request, the model writes a short program. It asks the cameras
where the parts are, sorts them by size, computes a target spot for each one,
and calls a pick-and-place routine in a loop. Research systems such as
[Code as Policies](https://code-as-policies.github.io/) show that this works,
and that it beats having the model issue one motion at a time. "Biggest on the
left" is a sort, and "a finger's width apart" is arithmetic, which is easy in a
program and unreliable when a model does it step by step.

So a program is the right choice. But the program runs inside the robot's
controller, next to everything else the controller can reach: the raw joint
driver that skips the speed and workspace limits, the camera feed, the file
system, and the factory network. The shelf robot and the depot robot have the
same problem, with shoppers or staff walking past.

![The job needs pick-and-place, but the program can reach the whole controller. An operator tells the arm to line up the red parts along the top edge, biggest on the left. The AI writes a program, which runs as soon as it is written. Inside the robot controller it can reach checked pick-and-place, which the job needs, and also the raw joint driver that skips the speed and zone limits, the camera feed that sees the operator, the controller's files, and the factory network.](/img/robot-policies-conflict.svg)

**How do we make sure a program written by a model never gets around the robot's
safety rules?**

## Why the obvious fixes fall short

- **"Filter the code before running it."** Code as Policies rejects any program
  whose text contains `import` or `__`, then runs it with `exec`. Both of these
  lines pass that filter and run:

  ```python
  open('/etc/hostname').read()           # exec supplies the builtins anyway
  np.savetxt('out.txt', np.zeros(1))     # numpy was handed in for the geometry
  ```

  A filter lists what is forbidden. Anything reachable that nobody thought to
  list gets through, and every library handed in for convenience adds more.
- **"Have someone review the program."** The operator is not a programmer, and
  the program runs once. Waiting for an engineer to review it takes longer than
  doing the task by hand.
- **"Only give the model motion tools."** Then the model issues one motion at a
  time, and does the sorting and spacing in its head. That is the approach the
  program replaced.
- **"Run the program in a sandbox."** A sandbox with no files or network, whose
  only way out is a checked pick-and-place call, does limit what the program
  can reach. But it learns what the program does only by running it. A
  forbidden call or a wrong argument on line 12 stops the program after lines 1
  to 11 have moved the arm, and half the job is left on the table. On a robot,
  a mistake has to be caught before the first move.

## The agentic solution

Give the program the robot as a Jo interface, and nothing else. The model
writes a Jo program against that interface, and the program is compiled before
the arm moves. Trusted code, written separately, implements the interface and
talks to the real controller.

```jo
// Positions are millimetres on the table, from its front-left corner.
class Point(x: Int, y: Int)
class Part(id: String, color: String, sizeMm: Int, pos: Point)
class Table(widthMm: Int, depthMm: Int)
class Zone(name: String, minX: Int, minY: Int, maxX: Int, maxY: Int)

interface Scene
  def table(): Table
  def parts(): List[Part]
  def keepOut(): List[Zone]
end

interface Arm
  // Refused over an edge, in a keep-out zone, or touching another part.
  // Returns "ok", or says why the move was refused.
  def place(partId: String, target: Point): String
  def say(text: String): Unit
end

param scene: Scene
param arm: Arm
```

A program for the first request is ordinary code:

```jo
def runTask(): Unit receives IO.stdout, scene, arm =
  val table = scene.table()
  val red = scene.parts().select(p => p.color == "red").sortBy(p => 0 - p.sizeMm)
  val gap = 20
  var left = gap
  for part in red do
    val target = new Point(left + part.sizeMm / 2, table.depthMm - gap - part.sizeMm / 2)
    println "\{part.id}: \{arm.place(part.id, target)}"
    left = left + part.sizeMm + gap
```

**What the program cannot name.** The program is compiled with only `scene` and
`arm` in scope. The joint driver, the camera frames, files, the network and
Python are simply not there. There is nothing to filter, because there is
nothing to call. A program that tries to use them fails to compile and never
starts.

**What the arm will not do.** `place` checks every target against the table,
the keep-out zones and the other parts, and moves at the speed the
implementation chooses. A program may ask for any move, but the implementation
decides whether it happens. These safety checks live in trusted code that the
model never writes.

**Nothing moves until the whole program compiles.** A Jo program is checked
whole before its first motion. A call to something not granted, or a part name
passed where a position belongs, stops it while every part is still where it
was. The model then gets the compiler's error, which names the line and the
reason, and writes a new program. Nothing has moved, so the retry costs
nothing. Code as Policies tried letting the model fix its own bugs and dropped
the idea as unreliable. There, a bug shows up while the arm is moving.

**Requests the robot cannot do fail early.** Code as Policies assumes every
request is feasible, yet its own demo includes "can you throw blocks?". `Arm`
has no `throw`, so a program that throws does not compile, and the model has to
tell the operator the cell cannot do that.

**Helpers are checked like the rest.** Models write these programs top-down.
Code as Policies has the model call helpers such as `line_up` or `spacing`
before they exist, and generates each one in a later call. In Jo the compiler
follows every call through every helper, however the helper was written. So
the compiler can tell whether a program touches the arm at all, even when the
call is buried three helpers deep.

**Asking needs no arm.** "Which part is closest to me?" only looks at the
table. The operator sends it with **Ask**. The program is then compiled with a
grant, the list of things it may use, and that grant leaves out the arm.
**Move** adds it:

```jo
defer def runTask(): Unit receives IO.stdout, scene        // Ask
defer def runTask(): Unit receives IO.stdout, scene, arm   // Move
```

With Ask, the arm stays still, however the model reads the request. If a helper
calls `arm.place`, the program does not compile, and the error shows the path
from `runTask` through each helper down to the call.

![A program sent with Ask counts the parts of each colour, then calls a helper named tidy that moves parts near the back edge. The compiler rejects it: the arm is not provided, and the trace runs from the call to tidy in runTask down to arm.place inside it. Nothing ran and nothing moved.](/img/robot-policies-compile-error.png)

The operator's button picks the grant, never the model. If the model decided
whether a request needs the arm, it would be choosing its own permissions. The
choice need not be a button. In the cell, the light curtain can allow only Ask
whenever a person is inside. In the supermarket, the shelf robot can get Move
only after closing.

**The same program runs in simulation first.** `Arm` is an interface, so a
simulator can implement it too. A new kind of request can be tried against the
simulated table, then run unchanged against the real arm.

**Other robots get their own interface.** For the depot robot, `Scene` lists
rooms, carts and closed corridors, and the robot offers `goTo` and `drop`
instead of `place`. The compiler's checks and the trusted implementation work
the same way.

![The model writes a Jo program. The compiler checks it against the grant: scene and arm after Move, scene only after Ask. A program that names the joint driver, a file or the network is rejected before anything moves. A program that passes calls the Arm interface, whose trusted implementation checks each move against the table and the keep-out zones before the controller moves the arm.](/img/robot-policies-boundary.svg)

## What it does not guarantee

- **Good moves.** The compiler proves which operations a program can call, not
  that a stack of parts will stand. That is the job of `place` and its checks,
  and of the emergency stop, which stays outside everything described here.
- **That the program ends.** The compiler allows a loop that never finishes, so
  the runner needs a time limit.
- **Instant response.** Each request waits for the model to write a program.
  That is fine for pick-and-place, and too slow for a closed control loop at
  hundreds of hertz, which should stay in the controller anyway.
- **Python's libraries.** The program cannot import `numpy` or `shapely`. The
  geometry it needs has to be written in Jo or offered through the interface.

## Try the demo

The [Robot Policies](https://github.com/typescope/robot-policies) demo is a
simulated pick-and-place cell: a table seen from above, eleven coloured parts,
the operator's strip along the front edge, and a fixture in one corner. The
operator types a request and presses **Ask** or **Move** to pick the grant.
When a program the AI wrote does not compile, the AI reads the error and writes
another one.

Five example programs run without an AI key. One lines up the red parts.
Another tries to bring the blue parts to the front. The cell refuses every move
there, so the program places them just behind the operator's strip instead:

![Running "Bring the blue parts to me". The arm reaches for each blue part and tries to set it down at the front edge. The cell refuses each move, because the front strip is the operator's keep-out zone, and a red outline marks the refused target. The program reads the reason and places the part just behind the strip instead. The move log fills in as the arm works, alternating refused and completed moves, and the arm says it may not enter the operator's side of the table.](/img/robot-policies-refused.gif)

Of the other three, one answers a question under Ask. The compiler rejects the
last two: an Ask program whose helper tidies up the table, and a program that
tries to save the layout to a file.

```sh
git clone https://github.com/typescope/robot-policies.git
cd robot-policies
pip install -r requirements.txt
cp .env.example .env
jo start
```

Open **http://127.0.0.1:8769**. Every run keeps the programs it tried, including
the ones that did not compile, with the compiler's error or the program's output
next to the moves the cell made or refused.

## Related work

[Code as Policies](https://code-as-policies.github.io/) (Liang et al., 2022)
introduced language-model-generated robot policy code, including the top-down
generation of helper functions. Its published demo runs the code with Python's
`exec` behind the text filter shown above.
