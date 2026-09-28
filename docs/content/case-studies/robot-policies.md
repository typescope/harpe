+++
title = "The Robot Policy Problem"
+++

Wherever people ask robots to do things, the requests change from day to day:
restock the shelves before the store opens, or move materials across a depot.
No engineer can program every request in advance. A language model can turn the
request into a small program that reads the scene and calls the robot's existing
motion primitives. In robotics, that program acts as a *policy*: it chooses
actions from observations.

This case study develops that design in a simulated robot cell: an arm, its work
table, and the fences and light curtains around them.

![An operator standing outside a robot cell says: line up the red parts along the top edge, biggest on the left. The AI writes a program for it, and the program runs in the cell. The cell is an arm, its work table, a fence and a light curtain on the operator's side. The arm is placing red parts in a row on the table, biggest on the left.](/img/robot-policies-cell.svg)

## The problem

An operator at the cell tells the arm:

> Line up the red parts along the top edge, biggest on the left, and leave a
> finger's width between them.

Ten minutes later the request is "which part is closest to me?", and after that
"bring the blue parts to me". Each request is new, each program runs once, and
the operator expects an answer or action now.

For the first request, the model writes a short program. It asks the cameras
where the parts are, sorts them by size, computes a target spot for each one,
and calls a pick-and-place routine in a loop. Research systems such as
[Code as Policies](https://code-as-policies.github.io/) show how generated code
can combine perception, arithmetic, control flow and robot primitives. "Biggest
on the left" becomes a sort, and "a finger's width apart" becomes arithmetic.
The program can perform both precisely without sending every intermediate value
through the model.

So a program is useful, but generated code is untrusted. If it runs in a general
Python process, it may reach much more than the task needs: low-level drivers,
camera frames, files, or the factory network. Putting the process in a container
can restrict the operating system around it, but it does not by itself express
the rule that this task may use checked pick-and-place and nothing else.

![The job needs pick-and-place, but the program can reach the whole controller. An operator tells the arm to line up the red parts along the top edge, biggest on the left. The AI writes a program, which runs as soon as it is written. Inside the robot controller it can reach checked pick-and-place, which the job needs, and also the raw joint driver that skips the speed and zone limits, the camera feed that sees the operator, the controller's files, and the factory network.](/img/robot-policies-conflict.svg)

**How do we let generated code plan a task without letting it bypass the narrow,
checked operations the robot exposes?**

## Why the obvious fixes fall short

- **"Filter the code before running it."** The published
  [Code as Policies demo](https://github.com/google-research/google-research/blob/master/code_as_policies/Interactive_Demo.ipynb)
  rejects any program whose text contains `import` or `__`, then runs it with
  `exec`. Both of these lines pass that filter and run:

  ```python
  open('/etc/hostname').read()           # exec supplies the builtins anyway
  np.savetxt('out.txt', np.zeros(1))     # numpy was handed in for the geometry
  ```

  A filter lists what is forbidden. Anything reachable that nobody thought to
  list gets through, and every library handed in for convenience adds more.
- **"Have someone review the program."** The operator is not a programmer, and
  the program runs once. Waiting for an engineer to review it takes longer than
  doing the task by hand.
- **"Only give the model motion tools."** Tool permissions help, but a model
  that calls one tool at a time must repeatedly exchange scene data and
  intermediate results. A generated program keeps the sort, geometry and loop
  local while still using the same narrow robot operations.
- **"Run the program in an OS sandbox."** This is useful defense in depth: it can
  limit files, network, CPU and memory. But once the isolated process needs to
  operate the robot, it needs a way through that boundary. A pipe, RPC or REST
  service can expose a narrow robot API, at the cost of another protocol,
  serialization, deployment and failure handling.

## A narrow, typed boundary

Using Jo's [compile-time sandboxing](/concepts/sandbox/), we can restrict the
actions of robot policies to the following narrow interface:

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
  // Preserves the cell's placement invariants or refuses the request.
  // Returns "ok", or says which invariant would be broken.
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

**The generated program has narrow authority.** Its external capabilities are
printing, `scene` and `arm`. The joint driver, raw camera frames, files, network
and Python are outside the guest's build. There is no forbidden-name list to
maintain: code that requires an unavailable capability does not compile.

**Every permitted operation can enforce invariants.** The trusted `place`
implementation checks that the part exists, the target lies on the table, the
part stays outside every keep-out zone, and the placement does not overlap
another part. It can also delegate trajectory, speed, reachability and collision
checks to the robot controller. The generated program may request a move; it
cannot make the implementation skip those checks.

This is where application rules belong. The same pattern can enforce invariants
such as "the gripper never enters the operator zone", "a loaded cart never uses
a pedestrian corridor", or "the total payload stays below 20 kg". Where
possible, the interface *makes invalid actions unrepresentable*: it exposes
domain operations and validated values instead of raw joints or controller
commands.

**Capability and type errors fail before execution.** Jo checks the whole
program before its first motion. A call to an ungranted operation, or a part name
passed where a position belongs, stops it while every part is still where it
was. The model receives a compiler error with the line and reason, then can
write a new program with no physical side effects from the failed attempt.

## What each layer guarantees

- **The compiler limits authority.** It proves which capabilities and operations
  the generated program may call, and checks their argument and result types. It
  does not prove that the program chose a useful sequence of calls.
- **The trusted interface preserves declared invariants.** It can reject a
  target, validate a whole plan, and delegate motion checks to the controller.
  Its guarantees are only as complete as its implementation and the state it
  observes.
- **The robot safety system protects people and equipment.** Safety-rated
  controllers, guards, light curtains and emergency stops remain independent of
  the generated program and of Harpe. This design does not replace them or by
  itself establish compliance with a robotics safety standard.

## Run the demo

The [Robot Policies](https://github.com/typescope/robot-policies) demo puts this
design into a simulated pick-and-place cell. An operator states a task, the
model writes a Jo policy, and the interface makes the boundary visible: the
compiler rejects authority the policy was not given, while the trusted cell
accepts or refuses each permitted operation.

When asked to bring the blue parts forward, for example, the policy first asks
to place them inside the operator's strip. The cell refuses those targets, so
the policy places the parts just behind the strip instead:

![Running "Bring the blue parts to me". The arm reaches for each blue part and tries to set it down at the front edge. The cell refuses each move, because the front strip is the operator's keep-out zone, and a red outline marks the refused target. The program reads the reason and places the part just behind the strip instead. The move log fills in as the arm works, alternating refused and completed moves, and the arm says it may not enter the operator's side of the table.](/img/robot-policies-refused.gif)

To run it locally, install Jo 0.13.5 or later and Python 3.12, then:

```sh
git clone https://github.com/typescope/robot-policies.git
cd robot-policies
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
jo start
```

Open [http://127.0.0.1:8769](http://127.0.0.1:8769). The checked-in examples
run without an API key; add a supported model key to `.env` for new requests.

## Related work

[Code as Policies](https://arxiv.org/abs/2209.07753) (Liang et al., 2022)
introduced language-model-generated robot policy code, including the top-down
generation of helper functions. Its published demo runs the code with Python's
`exec` behind the text filter shown above.
