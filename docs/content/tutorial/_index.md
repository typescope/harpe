+++
title = "Build Your First Agent"
sort_by = "weight"
template = "docs_section.html"
page_template = "docs_page.html"
weight = 1
+++
An agent built with Jo is an AI that **acts by writing typed Jo programs** against
capabilities you grant — and it's just a Jo project, run with `jo`. The fastest way to see
what that means is to build one. In a few minutes you'll have a chat agent running in your
terminal, and you'll have met every core idea along the way.

Want the reference instead of the walkthrough? Jump to [Concepts](@/tutorial/concepts.md).

## Install

```sh
curl -sSf https://jo-lang.org/install.sh | sh    # the jo toolchain
jo --version
```

That's the only install — the agent runtime comes in per project, not as a second tool.

## 1. Scaffold

```sh
jo new hello --template conversational
cd hello
```

You get a small agent that already runs — `jo.toml` pulls in the Harpe loop, so `jo run`
works before you write anything. The pieces you'll touch:

```
hello/
  jo.toml          # the agent app: depends on the Harpe loop; `jo run` launches it
  AGENT.md         # the agent's instructions (its persona)
  sandbox/
    api/           # what the agent can do: the runTask contract + capability interfaces
    runtime/       # how it's done: the implementations
    guest/         # the model's code lands here each turn (you don't edit this)
  .env.example     # model + secrets go here (copy to .env)
```

The scaffold has a few more files — `skills/`, `data/`, `logs/`, the Claude setup — but none of
them matter for this walkthrough. [Concepts](@/tutorial/concepts.md#whats-in-an-agent-project) tours
the full shape and explains the three `sandbox/` projects.

## 2. Add your model key

Every turn calls an LLM, so the agent needs a model and a key. Copy the example file and
fill it in:

```sh
cp .env.example .env
```

```sh
# .env
MODEL=claude-opus-4-8
ANTHROPIC_API_KEY=...
```

## 3. Run it

```sh
jo run
```

```
hello ▸ chat (type /quit to exit)

you ▸ hi! who are you?
bot ▸ Hi! I'm a small Jo agent. Ask me anything.
```

That's a working agent — with **no capabilities granted yet**, just conversation. Each
message you send is a **turn**: Harpe hands your message to the LLM, the LLM writes a tiny Jo
program to reply, and `jo` compiles and runs it. ([How a turn works](@/tutorial/concepts.md#how-a-turn-works).)

## 4. Teach it

`AGENT.md` is the agent's persona and standing rules — its system prompt. Edit it:

```markdown
# Hello Agent

You are a cheerful assistant who keeps answers to one or two sentences.
Today you are helping someone learn how Jo agents work.
```

Run `jo run` again and the tone changes. No capability needed — this is just instruction.

## 5. Grant a capability

So far the agent can only talk. To let it *do* something, you grant a capability — which is
just **an interface in `sandbox/api` and an implementation in `sandbox/runtime`** (no separate
`capabilities/` directory). Give it a read-only `Clock`.

Declare what it can do, and add it to the entry point's `receives` list:

```jo
// sandbox/api/src/Clock.jo
interface Clock
  def today(): String
end

param clock: Clock
```

```jo
// sandbox/api/src/Entry.jo — add `clock` so the model may receive it
defer def runTask(): Unit receives stdout, clock
```

Implement it in the runtime (trusted code — this is the only place that touches Python):

```jo
// sandbox/runtime/src/ClockImpl.jo
class ClockImpl()
  def today(): String = py.module("datetime").date.today().isoformat().asString
  view Clock
end
```

```sh
jo build --spec sandbox/guest/jo.toml     # type-check the agent end to end
jo run
```

```
you ▸ what's today's date?
bot ▸ It's 2026-06-24.
```

To answer, the model wrote and ran a small Jo program — the **only** thing it can do:

```jo
// sandbox/guest/src/Task.jo — written by the model
namespace UserTask
import jo.IO.stdout
import agentapi.*

// receives = exactly the capabilities you granted; nothing else is reachable
def runTask(): Unit receives stdout, clock =
  println("It's " + clock.today())
```

It **could not** have done anything else, because `clock` and `stdout` are the only
capabilities `api` exposes — and a program that names one you didn't grant doesn't compile.
That `receives` list *is* the agent's authority, checked every turn. Add a `Payment` and it
can charge; leave it out, and no prompt — however clever — can make it. That's the whole
[compile-time sandbox](@/tutorial/concepts.md#the-compile-time-sandbox); the
[entry point and the rest of the turn](@/tutorial/concepts.md#how-a-turn-works) are in
Concepts.

## In a hurry? Let Claude finish it

You just did every step by hand to see the pieces. Day to day, you'd let Claude Code do
them: the template ships a `CLAUDE.md` and a `build-agent` skill, so you describe the agent
and Claude grants the capabilities, writes `AGENT.md`, and runs `jo run` for you.

```sh
jo new hello --template conversational
cd hello
claude            # "a cheerful assistant that can tell the time and the weather"
jo run
```

## What you just learned

- An agent runs in **turns**; the LLM's only tool is to **write a Jo program** (`runTask`,
  in `sandbox/guest`).
- A **capability** is an `interface` in `sandbox/api` plus an implementation in `sandbox/runtime`;
  the entry point's **`receives`** list is the agent's entire authority — proven at compile
  time.
- **`AGENT.md`** is the persona; **`.env`** holds the model and secrets; **`data/`** holds
  state across runs (sessions, history); **`logs/`** holds the audit trail.

## Next steps

- [Concepts](@/tutorial/concepts.md) — the full model: the three `sandbox/` projects, the turn loop, and
  the security guarantee.
- [Conversational agent](@/tutorial/conversational-agent.md) — a real flight booker with paid actions
  and confirmation.
- [Request-driven](@/tutorial/request-driven-agent.md) · [Monitoring](@/tutorial/monitoring-agent.md) — the other
  two tutorial paths.
- [Create a custom capability](@/tutorial/create-custom-capabilities.md) — when the registry doesn't
  have what you need.
