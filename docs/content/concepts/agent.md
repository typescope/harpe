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

## A convenient assembly

Harpe provides a convenient assembly for developing agents:

```jo
class Agent(brain: Model, tools: List[Tool], context: Context)
```

This class pre-binds three inputs to the turn engine. Applications can instead
inject all the components through `Agent.runTurn` or organize them differently.

- `brain` is the provider-independent [model](/concepts/models/).
- `tools` are the actions offered directly to the model.
- `context` determines what information is presented to the model.

The class does not own user identity, session storage, locking, or UI state.
Those concerns stay in the driver.

An assembly is ordinary Jo code:

```jo
val agent = new Agent:
  brain = brain
  tools =
    Defaults.tools(approvalDeadline = 610.0) ++ memoryTools(memory)
  context = new WindowedContext:
    baseSystem = workspace.read("AGENT.md").getOrElse("")
    memory = memory
    initial = history

agent.runTurn(userMsg, interact, maxToolRounds = 50, maxRetries = 4)
```

Select another [model](/concepts/models/), add or remove
[tools](/concepts/tools/), or replace the
[context strategy](/concepts/context/). A driver can construct different
assemblies for different roles or sessions.

## Turn execution

The core runs an iterative model-tool loop:

![A turn gathers context, asks the model for either a program or a final result, compiles and runs each program, and returns its output to the model until the turn is complete.](/img/how-a-turn-works.svg)

Context provides the information relevant to the turn. The model either answers
or calls tools. Tool results return to the model, and the loop continues until
the model produces an answer or the turn stops. The driver receives the outcome
and decides how to present and persist it.

## Drivers

A driver connects the core to its application environment. It accepts input,
establishes user and session scope, invokes turns, and delivers results. It also
owns lifecycle concerns such as concurrency, persistence, and logging.

“Driver” describes an architectural role, not a required class or interface.
The CLI, Web, and Telegram applications implement that role differently while
using the same core components.

## Custom execution

The default turn loop can be used without constructing an `Agent`:

```jo
Agent.runTurn(
  userMsg, brain, tools, context, interact,
  maxToolRounds, maxRetries)
```

If the default coordination does not fit, build a loop over `Model` and
`Tool.runSafely`. The same components can support parallel tool execution,
planner and executor roles, or application-specific control between steps.
