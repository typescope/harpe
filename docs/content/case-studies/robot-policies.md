+++
title = "The Robot Policy Problem"
+++

A robot cell on a small-batch line changes jobs every few days. The cell is the
arm, its work table, and the fences and light curtains that guard them. Each
change used to mean a robotics engineer and a teach pendant. With a language model, the
person at the station can just say what they want, and the model writes the
program that moves the arm.

## The problem

An operator at a packing station tells the arm:

> Line up the red parts along the top edge, biggest on the left, and leave a
> finger's width between them.

The model writes a short program for this. It asks the cameras where the parts
are, sorts them by size, computes a target spot for each one, and calls a
pick-and-place routine in a loop. Research systems such as
[Code as Policies](https://code-as-policies.github.io/) show that this works,
and that it beats having the model issue one motion at a time. "Biggest on the
left" is a sort, and "a finger's width apart" is arithmetic, which is easy in a
program and unreliable when a model does it step by step.

A program is the right choice. But the program runs inside the robot's
controller process, next to everything else the controller can reach: the raw
joint driver that bypasses the speed and workspace limits, the camera feed, the
file system, and the plant network.

![The job needs pick-and-place, but the program can reach the whole controller. An operator tells the arm to line up the red parts along the top edge, biggest on the left. The AI writes a program, which runs as soon as it is written. Inside the robot controller it can reach checked pick-and-place, which the job needs, and also the raw joint driver that skips the speed and zone limits, the camera feed that sees the operator, the controller's files, and the plant network.](/img/robot-policies-conflict.svg)

**How can a program that a model wrote a second ago move the arm, yet reach
nothing but the moves it is supposed to make?**

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
- **"Have someone review the program."** The operator gave the command because
  they are not a programmer, and the arm is expected to move now.
- **"Only give the model motion tools."** Then the model issues one motion at a
  time, and does the sorting and spacing in its head. That is the approach the
  program replaced.
- **"Run the program in a container."** A container decides which files and
  sockets a process gets. The rules that matter here are about motion: stay in
  the workspace, stay out of the operator's side, never skip the speed limit.
  The program needs the arm to do its job, so the container must let it through,
  and then the container has nothing more to say.

## The agentic solution

Give the program the robot as a Jo interface, and nothing else. The model
writes a Jo program against that interface, and the program is compiled before
the arm moves. The interface is implemented separately in trusted code, which
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

A program for the command above is ordinary code:

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

**What the program cannot name.** The joint driver, the camera frames, files,
the network and Python are absent from the program's compilation environment.
There is nothing to filter, because there is nothing to call. A program that
tries is a compile error, and it never starts.

**What the arm will not do.** `place` checks every target against the table,
the keep-out zones and the other parts, and moves at the speed the
implementation chooses. A program may ask for any move. The implementation
decides whether it happens. This safety envelope lives in trusted code the
model never writes.

**Helpers are checked like the rest.** Models write these programs top-down.
Code as Policies has the model call helpers such as `line_up` or `spacing`
before they exist, and generates each one in a later call. In Jo the compiler
follows every call through every helper, however it came to be. The compiler
can therefore tell whether a program touches the arm at all, even when the call
is buried three helpers deep.

**Asking needs no arm.** "How many red parts are left?" or "which part is
closest to the bin?" only look at the table. The operator sends those with
**Ask**, and the program is compiled against the same interface with a grant
that leaves the arm out. **Move** adds it:

```jo
defer def runTask(): Unit receives IO.stdout, scene        // Ask
defer def runTask(): Unit receives IO.stdout, scene, arm   // Move
```

After Ask, the arm stays still whatever the model makes of the request. If a
helper calls `arm.place`, the program does not compile, and the error traces
the path from `runTask` through each helper down to the call.

![A program sent with Ask counts the parts of each colour, then calls a helper named tidy that moves parts near the back edge. The compiler rejects it: the arm is not provided, and the trace runs from the call to tidy in runTask down to arm.place inside it. Nothing ran and nothing moved.](/img/robot-policies-compile-error.png)

The operator's button picks the grant, never the model. A model that decided
whether a request needs the arm would be choosing its own authority. In a real
cell the choice need not be a button: the light curtain can allow only Ask
whenever a person is inside.

**Nothing moves before the whole program checks.** With `exec`, a mistake on
line 12 surfaces after lines 1 to 11 have already moved the arm, and the job
stops halfway through. A Jo program is compiled whole before its first motion,
so a call to something not granted, or a part name passed where a position
belongs, stops it while every part is still where it was.

**The same program runs in simulation first.** `Arm` is an interface, so a
simulator can implement it too. A new kind of command can be tried against the
simulated table, then run unchanged against the real arm.

![The model writes a Jo program. The compiler checks it against the grant: scene and arm after Move, scene only after Ask. A program that names the joint driver, a file or the network is rejected before anything moves. A program that passes calls the Arm interface, whose trusted implementation checks each move against the table and the keep-out zones before the controller moves the arm.](/img/robot-policies-boundary.svg)

## What it does not guarantee

- **Good moves.** The compiler proves which operations a program can call, not
  that a stack of parts will stand. That is the job of `place` and its checks,
  and of the emergency stop, which stays outside everything described here.
- **That the program ends.** A loop that never finishes is permitted. The runner
  needs a time limit.
- **Instant response.** Compiling adds time to every command. That is fine for
  pick-and-place, and too slow for a closed control loop at hundreds of hertz,
  which should stay in the controller anyway.
- **Python's libraries.** The program cannot import `numpy` or `shapely`. The
  geometry it needs has to be written in Jo or offered through the interface.

## Try the demo

The [Robot Policies](https://github.com/typescope/robot-policies) demo is a
simulated pick-and-place cell: a table seen from above, eleven coloured parts,
the operator's strip along the front edge, and a fixture in one corner. The
operator types a request and presses **Ask** or **Move**, which decides the
grant.

Five example programs run without an AI key. One lines up the red parts. One
tries to bring the blue parts to the front, where every move is refused, so it
places them just behind the operator's strip instead:

![Running "Bring the blue parts to me". The arm reaches for each blue part and tries to set it down at the front edge. The cell refuses each move, because the front strip is the operator's keep-out zone, and a red outline marks the refused target. The program reads the reason and places the part just behind the strip instead. The move log fills in as the arm works, alternating refused and completed moves, and the arm says it may not enter the operator's side of the table.](/img/robot-policies-refused.gif)

The other three answer a question after Ask, and show two programs the compiler
rejects: an Ask program whose helper tidies up, and one that tries to save the
layout to a file.

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
