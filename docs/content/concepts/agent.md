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
boundary depends on the speaker's perspective. A user may mean the whole system
they interact with, while a developer may mean a particular assembly of models,
tools, and context.

An agent combines a model with the tools and conversation context it needs to
help a user. Your application supplies those parts when it asks Harpe to run a
turn. It also decides how users interact with the turn and how conversations
are stored.

![A driver owns sessions, persistence, and presentation. Its core coordinates a model, tools, and context through an iterative turn engine.](/img/agent-components.svg)

## Building an agent

`Agent.ask` runs one [turn](/concepts/turn/). Each argument supplies one part of
the agent:

```jo
def ask(
    message: String,
    attachments: List[String] = NoAttachments,
    brain: Model = Model.default,
    tools: Toolset = Toolset.empty,
    interact: Interact = Interact.unattended,
    context: Context = Context.noHistory,
    maxToolRounds: Int = 50,
    maxRetries: Int = 4,
    maxOutputTokens: Int = 8192)
: TurnData receives logger
```

The smallest agent is one call inside an explicit logging scope:

```jo
with logger = Logging.discard in
  Agent.ask("hello")
```

For an application, supply the parts you want to keep across turns:

```jo
val runCode = RunCodeTool(sandboxDir, approvalDeadline = 610)
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

- `brain` chooses the [model](/concepts/models/).
- `tools` defines what the model can [do](/concepts/tools/).
- `context` defines what the model remembers and sees.
- `transcript` records the conversation independently of model context.
- `interact` connects progress, cancellation, and approval to your user
  interface.

`Agent` is a namespace, not a class you construct. The arguments to `ask`
describe the agent for that turn. Reuse values such as `brain`, `tools`, and
`context` when they should live across turns.

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

None of these owns user identity, session storage, locking, or UI state. Those
stay in the driver.

## Drivers

A driver connects the core to its application environment. It accepts input,
establishes user and session scope, invokes turns, and delivers results. It also
owns lifecycle concerns such as concurrency, persistence, and logging.

“Driver” describes an architectural role, not a required class or interface.
The PDF processing agent and Telegram bot implement that role differently while
using the same core components.

The [Turn](/concepts/turn/) concept describes the model-tool loop and the events
through which a driver observes work in progress.
