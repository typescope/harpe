+++
title = "Concepts"
weight = 1
+++
Once you've built the [hello-world agent](@/tutorial/_index.md), this page is the working model you need
to build your own: what an agent is made of, how a turn runs, and how the capabilities you
grant keep it safe.

An agent is an AI that **acts by writing typed [Jo](https://jo-lang.org/overview/language-tour)
programs** inside a capability sandbox — and it's just a set of small **Jo projects**, built
and run with `jo`. You describe two things:

- **Capabilities** — what the agent is *able* to do (send a message, read a calendar,
  query a DB), each one narrow enough that granting it is safe.
- **Skills** — what the agent *knows* (policies, tone, domain rules), in plain Markdown it
  consults as it works.

The rest — the LLM, the turn loop, connectors, the audit log — comes from the **Harpe**
runtime, a library your projects depend on (think Rails or Next.js, not a separate tool).

## Three kinds of agents

Start with the tutorial closest to what you want to build. Each one uses the same sandbox
model, but starts from a different use case:

| Kind | Template | Good for | Example | Guide |
|---|---|---|---|---|
| **Conversational** | `--template conversational` | agents a person talks to | flight-booking assistant (CLI / WhatsApp) | [conversational-agent.md](@/tutorial/conversational-agent.md) |
| **Request-driven** | `--template request-driven` | webhooks, inbound email, one-shot events | GitHub PR reviewer (webhook) | [request-driven-agent.md](@/tutorial/request-driven-agent.md) |
| **Monitoring** | `--template monitoring` | scheduled monitors, policy watchers, recurring checks | inventory monitor | [monitoring-agent.md](@/tutorial/monitoring-agent.md) |

Then follow that kind's guide for the specifics. What they all share is the **typed sandbox**
the rest of this page describes — how the LLM's code is confined to the capabilities you
grant. That part is the same wherever you go, so learn it once here.

## What's in an agent project

An agent is a small Jo **app** whose `jo.toml` pulls in the **Harpe loop** — so `jo run`
launches a working agent with **no source files of your own**. The work you'll actually do
sits under `sandbox/` — one small Jo project whose three **modules** define and confine what
the LLM can do:

```
my-agent/
  jo.toml              # the agent app: depends on the Harpe loop and points `main` at it
  sandbox/
    jo.toml            # one project, three modules: api, runtime, guest
    Entry.jo           # api module: the runTask the LLM implements + capability interfaces
    Runtime.jo         # runtime module: implements the interfaces, builds capabilities, supplies them
    Task.jo            # guest module: the LLM's code, rewritten & recompiled each turn
    run.sh             # optional: external confinement wrapper (opt-in)
    # each module's `src` lists its files (or directories) — organize them however you like
  AGENT.md             # the agent's instructions (persona and rules)
  skills/              # Markdown knowledge the agent looks up
  .env                 # model, API key, operator, capability secrets (from .env.example)
  data/                # persistent state across runs: sessions, chat history, world-state
  logs/                # the audit log — what each turn did
  CLAUDE.md            # onboards Claude Code to finish the agent
  .claude/skills/      # helper skills for Claude Code
```

The top-level `jo.toml` *is* the whole agent app — there's no `main` for you to write. It
depends on the Harpe loop library and points the program entry at one of its loops; which
loop you pick is what makes the agent conversational, request-driven, or monitoring:

```toml
# jo.toml — a complete simple agent; no source files
jo = "0.12"

[module.app]
kind = "app"
platform = "python"
enable-ffi = true
src = []                                       # no source files of your own

packages = [{ name = "harpe", version = "0.12" }]   # the agent loop: the turn cycle and the audit log

links = [
  { from = "jo.main", to = "Harpe.cli" },      # which loop runs the agent (cli / http / schedule)
]
```

Under `sandbox/`, the three modules depend on one another in one direction — and that
direction *is* the security boundary:

<img src="/img/project-deps.svg" alt="A dependency triangle of the three sandbox modules. api, the contract, sits at the top. guest (untrusted) uses api — it compiles its runTask against the contract and interfaces — and links runtime, which supplies the real entry point and capability implementations. runtime (the trusted host) implements the interfaces api declares." style="display:block;margin:1.5rem auto;width:100%;height:auto" />

- **`api`** — the contract. Declares the entry point the LLM implements
  (`defer def runTask(): Unit receives …`) and the **interfaces** for this agent's
  capabilities. It's the only surface the LLM's code ever sees.
- **`runtime`** — the trusted host. Implements those interfaces, builds the capability
  objects, and supplies them to `runTask` each turn.
- **`guest`** — the one **untrusted** module: where the LLM's `runTask` lands, recompiled
  fresh against `api` with `runtime` linked in.

The LLM only ever writes `guest`, and `guest` can only call what `api` exposes and
`runtime` supplies. **Most agents need nothing else:** you add a capability by putting its
interface in `api` and its implementation in `runtime` — no separate `capabilities/`
directory. (Reusable capabilities *can* live in their own package; see
[Create a Custom Capability](@/tutorial/create-custom-capabilities.md).)

## How a turn works

Everything an agent does happens in a **turn**, set off by a message, a request, or the clock.
A turn runs an **LLM ↔ program loop**: the LLM writes a Jo program, the runtime compiles and
runs it, and the result comes back to the LLM — which writes another program if it needs to,
and stops when it has a final result.

<img src="/img/how-a-turn-works.svg" alt="A turn runs an LLM-program loop. A message, request, or tick prepares the LLM task by gathering context. The LLM then either emits a runCode tool call or a final result. A runCode call is compiled — the security checkpoint — and run with the runtime supplying capabilities; its output always returns to the LLM, and a compile error likewise loops back. When the LLM is done, the runtime handles the result — replying, responding, or logging, depending on the agent — and records the whole turn." style="display:block;margin:1.5rem auto;width:100%;height:auto" />

Two facts about that loop shape how you build. **The LLM's only tool is to write a Jo
program** (the `runCode` call above) — every reply, API call, and computation is generated Jo,
so effects happen *only* inside a compiled program and *only* through the capabilities you
grant. And the **compile step is the security checkpoint**: nothing runs until it type-checks
against your contract, and a compile error goes back to the LLM to fix before anything runs.

The program the LLM writes implements one **entry point**, declared once in `api`: its
name, return type, and the capabilities it `receives`. That declaration is
the single place you say what the LLM's program must look like. You edit its `receives`
list; the LLM fills in the body:

```jo
// sandbox/Entry.jo (api module) — the contract; you edit the receives list
defer def runTask(): Unit receives time, stdout

// sandbox/Task.jo (guest module) — the LLM writes this, each step of the loop
def runTask(): Unit receives time, stdout =
  println("Today is " + time.today().toString)
```

Two things to take from that:

- **The `receives` clause is the grant.** It names exactly the capabilities your `api`
  exposes and your `runtime` supplies; a program that reaches for anything else doesn't
  compile, so it never runs.
- **You never write `runTask` — the LLM does, each step of the loop.** Your job is to
  choose the capabilities (in `api`/`runtime`) and steer it with `AGENT.md` and skills; the
  runtime supplies the implementations and runs each program the LLM writes.

## The compile-time sandbox

Most sandboxes run at *runtime* — a monitor that watches each call and blocks the forbidden
ones, something you have to configure correctly and that a clever input can keep probing for
gaps. Jo's sandbox runs at *compile time* instead: the LLM's code is compiled as the
`guest` module, and the only names it can resolve are what `api` exposes and `runtime`
supplies — the `receives` clause of `runTask`. Reaching for anything else isn't blocked while
the program runs; it fails to *compile*, so the program never starts. There is no policy
engine or runtime gate to get wrong — the type-check is the boundary.

<img src="/img/typed-sandbox.svg" alt="The compiled program contains two boxes: the guest — the LLM-generated, untrusted code — and the trusted runtime. The guest's border is a sealed boundary, a DMZ enforced by the type-check, punctured only by typed API holes (here stdout, clock, payment) that link out to the runtime. The runtime in turn performs the real effects on the world outside the program. The guest has no ambient access; its only way out is through a granted capability." style="display:block;margin:1.5rem auto;width:100%;height:auto" />

That makes the security model a guarantee rather than a setting:

> An agent can affect the world **only** through the capabilities you grant it, and no
> capability can be used beyond what its **type** allows. This is enforced when the code
> compiles, so it holds even if the LLM is fooled by a malicious input.

The last clause is the point: a prompt injection can change what the program *says*, but not
what it can *reach* — that's fixed by the types, before anything runs.

The types bound what the guest can reach; identity is the one thing kept deliberately *out* of
its reach. When a capability needs to know *who* the turn is for — a user, a tenant — that
can't travel through the program: the LLM is untrusted and could forge it to reach someone
else's data. The runtime instead sets it as a **per-turn environment** that trusted capability
implementations read to scope themselves (a `db` that serves only the current user's rows);
the guest never sees it. `runTask` just calls `db.query(…)` — the scoping is the runtime's,
invisible to the LLM.

The craft is keeping capabilities **narrow** — the bound lives in the *interface* (and its
config in `runtime`), not in a guard you write:

- a `Tests` interface whose one method runs a fixed command, not raw `shell`;
- a `Payment` whose implementation is capped at $2,000, not "spend money";
- an `Inventory` with only read methods, never a write.

A narrow capability is safe to grant and needs no runtime supervision. Everything the agent
does is written to the **audit log** under `logs/`, so you can review and undo.
