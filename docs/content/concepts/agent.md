+++
title = "The agent"
weight = 1
+++
At the center of Harpe is the **Agent** — a small bundle plus a turn engine. The
bundle is what makes an agent *this* agent. The engine drives one user turn to a
final answer. Everything around it — sessions, persistence, the UI — belongs to
the **driver**. This page is the overview: the pieces, the turn logic, and how you
configure or replace them.

## Start from an application

Use `hello` to inspect the smallest complete Harpe project:

```sh
jo new my-agent --template typescope/harpe:hello
```

For a real application, pick the interface closest to what you want to build:

```sh
jo new my-agent --template typescope/harpe:cli
jo new my-agent --template typescope/harpe:web
jo new my-agent --template typescope/harpe:telegram
```

These are starting points, not categories that constrain the finished agent.
The generated source belongs to you: change its input loop, add a webhook or
schedule, replace its presentation, or combine it with other application code.
The same engine and typed sandbox work regardless of what starts a turn.

The tutorials walk through the generated source for the [CLI
application](/tutorial/create-cli-agent/), [web
application](/tutorial/create-web-agent/), and [Telegram
application](/tutorial/create-telegram-agent/).

## What's in an agent project

An agent is a Jo app whose `jo.toml` selects a Harpe driver. The work specific to
your agent lives in its instructions, skills, and sandbox:

```text
my-agent/
  jo.toml          # selects the driver and launches the Harpe loop
  AGENT.md         # persona and standing instructions
  skills/          # reference material consulted on demand
  sandbox/
    jo.toml        # api, runtime, and guest modules
    SandboxAPI.jo  # the typed contract and capability interfaces
    SandboxRuntime.jo # trusted capability implementations
    Task.jo        # untrusted model-written program, replaced every turn
  data/            # sessions, history, and working memory
  logs/            # structured audit trail
```

The sandbox modules depend in one direction: the untrusted `guest` can see only
the interfaces in `api`. The trusted `runtime` supplies their implementations.
That dependency boundary is what prevents model-written code from reaching
ambient files, network, shell, or secrets.

![The api module defines the contract shared by the untrusted guest and trusted runtime. The guest implements runTask against that contract, while the runtime supplies the capability implementations.](/img/project-deps.svg)

## The compile-time sandbox

The model's only way to act is to write the body of `runTask`. Its declaration
names the complete authority available during that turn:

```jo
// api: the contract you control
defer def runTask(): Unit receives time, stdout

// guest: the implementation the model writes
def runTask(): Unit receives time, stdout =
  println("Today is " + time.today().toString)
```

Nothing runs until the generated program type-checks. If it names a capability
that is not declared and supplied, compilation fails before the program starts.
The [sandbox reference](/concepts/sandbox/) covers the capability gate and the
optional OS-level restrictions in detail.

![The compiled guest is sealed behind a type-checked boundary. Its only paths to the trusted runtime and outside world are the typed capabilities explicitly granted to it.](/img/typed-sandbox.svg)

## The framework agent

Inside the driver, the framework represents the turn engine and its dependencies
with one small bundle:

```jo
class Agent(brain: Model, tools: List[Tool], context: Context)
```

An agent is four things (the fourth, its turn policy, is passed per turn):

- a **brain** — the [model](/concepts/models/) it thinks with.
- **tools** — its [capabilities](/concepts/tools/) (including the memory tools).
- a **context** — the [strategy](/concepts/context/) that composes what the model sees each
  request.
- a **turn policy** — how many tool rounds a turn may take.

Two things are deliberately *not* the agent: session lifecycle (persistence,
locking) and presentation (spinners, streaming). The engine does no I/O of its own
— it reports every visible moment through an injected `Interact` handler — so it
stays provider- and UI-agnostic.

## The pieces

The agent composes the framework's parts. Each has its own guide:

- **[Model](/concepts/models/)** — the provider-agnostic LLM.
- **[Tools](/concepts/tools/)** — how the agent acts: `runCode` plus any you add.
- **[Structured output](/concepts/structured-output/)** — why typed Jo programs usually
  replace schema-formatted final answers.
- **[Skills](/concepts/skills/)** — read-only reference the agent consults on demand.
- **[Memory](/concepts/memory/)** — the durable key/value scratchpad the agent curates.
- **[Context](/concepts/context/)** — what the model sees: prompt + transcript window + memory.
- **[Logging](/concepts/logging/)** — the structured event stream (runs, model usage, your own).

## A turn, step by step

`runTurn` drives one user message to an answer:

![A turn gathers context, asks the model for either a program or a final result, compiles and runs each program, and returns its output to the model until the turn is complete.](/img/how-a-turn-works.svg)

1. **Mark** a rollback point and append the user's message to the context.
2. **Render** — the context composes what the model sees (system prompt, transcript
   window, memory).
3. **Ask** the model, offering the tools. A transient error retries with backoff
   (up to `maxRetries`). A fatal one ends the turn.
4. **Plain-text reply** → that's the answer. Done.
5. **Tool calls** → run each (a throw becomes an error result, never a crash), feed
   the results back into the context, and loop to step 2.

The loop is bounded: after `maxToolRounds` rounds the model is asked once more with
**no tools**, forcing a text answer. Cancellation (through `interact`) rolls the
turn back cleanly at any point.

The result is a `TurnResult`:

```jo
union TurnResult = Answered(delta, text) | Interrupted | Failed
```

`Answered` carries the turn's new messages (the `delta`, for the driver to archive)
and the final text. Memory is **not** rolled back on `Interrupted`/`Failed` — an
`updateMemory` is an intentional act, independent of turn outcome.

## The driver's job

A driver (cli, web, or telegram) wraps the engine with everything it leaves out:

- **assembles** the agent for each session.
- **runs** the loop — read input, call `runTurn`, show the reply.
- **implements `Interact`** — how a turn reports progress (`emit`), whether it's
  cancelled, and how it waits during backoff.
- **owns** sessions and persistence — the transcript archive and the memory snapshot.

The shipped applications differ in their I/O and session handling. The agent
engine is identical across them.

## Configuring your agent

For the common case you write no engine code. A working agent is:

- **`AGENT.md`** — the system prompt (role, instructions, pointers to skills/memory).
- **`skills/`** — reference docs.
- **`.env`** — the provider key (see [models](/concepts/models/)).
- **`src/` driver code** — where the pieces are assembled, meant to be edited.

The shipped drivers wire the defaults inline:

```jo
val agent = new Agent:
  brain = brain                                           // Defaults.model(), shared for the process
  tools = Defaults.tools() ++ memoryTools(memory)          // runCode + skills + memory
  context = new WindowedContext:
    baseSystem = workspace.read("AGENT.md").getOrElse("")
    memory = memory
    initial = history

agent.runTurn(userMsg, interact, maxToolRounds = 50, maxRetries = 4)
```

Customize by editing the driver: add a tool (`Defaults.tools() ++ [myTool]`),
swap the context strategy (a `SummarizingContext`), pin a specific model, or
change the budgets. This is plain code, not configuration — it assumes freely and
you diverge by writing Jo.

## Building your own

`Agent` is a bundle, not a base class (Jo has no inheritance), so "a different
agent" is just a different assembly or a different class — at three levels:

- **A different bundle.** Construct `Agent` with your own tools and context — e.g. a
  sub-agent with a narrow toolset and its own prompt.
- **A different class.** Write your own agent type and reuse the engine by calling
  `Agent.runTurn(userMsg, brain, tools, context, interact, maxToolRounds, maxRetries)`
  directly.
- **A different turn loop.** If the render → ask → tools → repeat policy doesn't fit
  (parallel tool calls, a planner/executor split, human approval between steps),
  write your own loop over `Model.reply` and `Tool.runSafely` — both are public.
  `Agent.runTurn` is the default policy, not the only one.
