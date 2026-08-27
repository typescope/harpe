+++
title = "Agent"
+++
## What is an agent?

In [*The Concept of Mind*](https://en.wikipedia.org/wiki/The_Concept_of_Mind),
Gilbert Ryle describes a visitor who is shown the colleges, libraries,
laboratories, and offices of a university, then asks where the university itself
is. The university is not another building. It is the way those institutions
are organized and coordinated.

An agent is likewise not one component, but a way of organizing components. Its
boundary depends on the speaker's perspective: a user may mean the whole
system they interact with, while a developer may mean a particular assembly of
models, tools, and context.

What matters is a robust, flexible structure that enables different components
to work together while keeping each independently extensible and customizable.

![A driver owns sessions, persistence, and presentation. Its core coordinates a model, tools, and context through an iterative turn engine.](/img/agent-components.svg)

## There is no Agent object

Harpe has no `Agent` class, and this is the reason why.

Suppose there were one. It would hold some of what a turn needs — a model, some
tools, a context — while the rest stayed arguments. Ask why the boundary falls
there and the answer runs out. Why is the tool budget a turn policy but the
toolset the agent? Any answer describes a habit, not a distinction. Naming a
subset "the agent" is pointing at a fourth building.

So a turn takes what a turn needs, and each input is an ordinary parameter with
a default:

```jo
def ask(
    message: String,
    attachments: List[String] = NoAttachments,
    brain: Model = Model.default,
    tools: Toolset = Toolset.empty,
    interact: Interact = Interact.unattended,
    context: Context = Context.noHistory,
    maxToolRounds: Int = 50,
    maxRetries: Int = 4)
: TurnData receives logger
```

The smallest agent is one call inside an explicit logging scope:

```jo
with logger = Logging.discard in
  Agent.ask("hello")
```

`Agent` there is a namespace, not a thing. A driver writes the same call with
its own pieces supplied:

```jo
val runCode = RunCodeTool(sandboxDir, approvalDeadline = 610.0)
val tools = SkillTools.toolset(skillsDir) ++ runCode.toolset()

val context = new WindowedContext:
  baseSystem = "You are a helpful assistant."
  initial = history

with logger = sessionLog in
  Agent.ask:
    text
    brain = brain
    tools = tools
    interact = channel
    context = context
```

Nothing was assembled. The same function served both, and the difference
between the two agents is entirely in the arguments.

### What the defaults mean

A default is evaluated at each call that omits it, so `context` defaulted is a
fresh `Context.noHistory` per turn. It holds the turn it is given — the model sees the
user's input and every tool result — and is discarded at the end. Two defaulted
turns never see each other's transcript. Remembering across turns is what a
driver's own `context` is for, and keeping one alive is the whole of it.

`logger` is a required context parameter. A caller that intentionally records
nothing binds `Logging.discard`. `interact` is an ordinary argument defaulting
to `Interact.unattended`. Drivers with an active user pass their live channel as
`interact = channel`.

- `brain` is the provider-independent [model](/concepts/models/).
- `tools` is a [`Toolset`](/concepts/tools/): each entry is a spec the model is
  offered wired to the code that answers it.
- `context` determines what the model is shown — see
  [context](/concepts/context/).

None of these owns user identity, session storage, locking, or UI state. Those
stay in the driver.

## Drivers

A driver connects the core to its application environment. It accepts input,
establishes user and session scope, invokes turns, and delivers results. It also
owns lifecycle concerns such as concurrency, persistence, and logging.

“Driver” describes an architectural role, not a required class or interface.
The CLI, Web, and Telegram applications implement that role differently while
using the same core components.

The [Turn](/concepts/turn/) concept describes the model-tool loop and the events
through which a driver observes work in progress.

## Custom execution

`ask` is one coordination, not the only one. If it does not fit, build a
loop over `Model` and `Tool.runSafely`. The same components support parallel
tool execution, planner and executor roles, or application-specific control
between steps — and because there was never an `Agent` to be outside of, such a
loop is not a departure from the framework. It is the same parts, coordinated
differently.
