+++
title = "The agent"
weight = 1
+++
At the center of Harpe is the **Agent** — a small bundle plus a turn engine. The
bundle is what makes an agent *this* agent; the engine drives one user turn to a
final answer. Everything around it — sessions, persistence, the UI — belongs to
the **driver**. This page is the overview: the pieces, the turn logic, and how you
configure or replace them.

```jo
class Agent(brain: Model, tools: List[Tool], context: Context)
```

An agent is four things (the fourth, its turn policy, is passed per turn):

- a **brain** — the [model](@/concepts/models.md) it thinks with;
- **tools** — its [capabilities](@/concepts/tools.md) (including the memory tools);
- a **context** — the [strategy](@/concepts/context.md) that composes what the model sees each
  request;
- a **turn policy** — how many tool rounds a turn may take.

Two things are deliberately *not* the agent: session lifecycle (persistence,
locking) and presentation (spinners, streaming). The engine does no I/O of its own
— it reports every visible moment through an injected `Interact` handler — so it
stays provider- and UI-agnostic.

## The pieces

The agent composes the framework's parts; each has its own guide:

- **[Model](@/concepts/models.md)** — the LLM. Ask it for a reply; provider-agnostic.
- **[Tools](@/concepts/tools.md)** — how the agent acts: `runCode` plus any you add.
- **[Skills](@/concepts/skills.md)** — read-only reference the agent consults on demand.
- **[Memory](@/concepts/memory.md)** — the durable key/value scratchpad the agent curates.
- **[Context](@/concepts/context.md)** — what the model sees: prompt + transcript window + memory.
- **[Logging](@/concepts/logging.md)** — the structured event stream (runs, model usage, your own).

## A turn, step by step

`runTurn` drives one user message to an answer:

1. **Mark** a rollback point and append the user's message to the context.
2. **Render** — the context composes what the model sees (system prompt, transcript
   window, memory).
3. **Ask** the model, offering the tools. A transient error retries with backoff
   (up to `maxRetries`); a fatal one ends the turn.
4. **Plain-text reply** → that's the answer; done.
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

- **assembles** the agent for each session;
- **runs** the loop — read input, call `runTurn`, show the reply;
- **implements `Interact`** — how a turn reports progress (`emit`), whether it's
  cancelled, and how it waits during backoff;
- **owns** sessions and persistence — the transcript archive and the memory snapshot.

The three shipped drivers differ only in their I/O; the agent and engine are
identical across them.

## Configuring your agent

For the common case you write no engine code. A working agent is:

- **`AGENT.md`** — the system prompt (role, instructions, pointers to skills/memory);
- **`skills/`** — reference docs;
- **`.env`** — the provider key (see [models](@/concepts/models.md));
- **`src/` driver code** — where the pieces are assembled, meant to be edited.

The shipped drivers wire the defaults inline:

```jo
val agent = new Agent:
  brain = brain                                           // Defaults.model(), shared for the process
  tools = Defaults.tools() ++ memoryTools(memory)          // runCode + skills + memory
  context = new WindowedContext:
    baseSystem = workspace.read("AGENT.md").getOrElse(() => "")
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
