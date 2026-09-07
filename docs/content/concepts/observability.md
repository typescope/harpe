+++
title = "Observability"
+++
An agent turn is a lot of things happening out of sight: a model call, a program
compiled and run in a sandbox, a retry, a file delivered. When a turn goes wrong,
"the agent said something odd" is the only symptom you get from the outside.

Everything you need is already recorded. Each turn writes a
[structured log](/concepts/logging/), and the driver brackets the parts that make
up the [transcript](/concepts/transcript/). This page is about *reading* it —
first live in a browser, then from the command line.

## The journal viewer

A `Logger` is write-only, so nothing can show you a log while it is being
written. `TailLogger` is a `Logger` that keeps the last `capacity` entries in
memory and lets them be read back. Tee it beside the backend you already had, so
the file still gets everything:

```jo
val tail = new TailLogger(capacity = 5000)
val log  = new TeeLogger([new JsonlLogger(sessionPath), tail])
```

`Viewer` serves that tail as two routes:

```jo
case Http.Get("/journal")        => Http.respondHtml(Viewer.page(id, "/journal/events"))
case Http.Get("/journal/events") => Viewer.respondEvents(tail)
```

An entry is visible the moment it is logged — no flush, no second process, no
path to agree on.

`Viewer.page` returns one self-contained page, so those two routes are the whole
integration: no stylesheet or script URL to route, and the path is yours to
choose. An agent with no HTTP server of its own takes `Viewer.start` instead,
which binds a port on a daemon thread:

```jo
val _ = Viewer.start(tail, title, "127.0.0.1", port)
```

The framework provides the mechanism and stops there. Whether to expose a
journal, on which port, behind which path, and to whom is a driver's decision —
see [Before you expose it](#before-you-expose-it).

## One tail, or one per session

Nothing about a tail says how many conversations are in it. A server driving
concurrent sessions can tee them all into one:

```jo
val log = new TeeLogger([new JsonlLogger(sessionPath(id)), sharedTail])
```

The page pairs each turn's bracket **within the scope its records carry**, not
positionally, so interleaved sessions render as separate cards rather than
closing each other's turns. That scope is whatever
[`Logging.withContext`](/concepts/logging/) installed — the outermost one, since
scopes nest inward — and it is labelled on each card once more than one is
present. Filter to a single conversation by typing its id.

Giving each session its own `TailLogger` and routing per session works the same
way, through the same two functions. Which to do is a driver's call: one tail is
one page for the whole process, and per-session tails keep one conversation out
of another's view.

## What it shows

![A journal for one session. Each bracketed turn is a card with a coloured left edge; inside it, timestamped rows pair an event chip with the record's content. Assistant messages, tool results, runCode executions and model calls are each tinted differently, and the header carries the filter, the turns-only and follow toggles, a live indicator, and the entry count.](/img/journal-viewer.png)

Turns are cards, opened by a `harpe.turn.request` and closed by its response,
with an outcome badge — *answered*, *failed*, *interrupted*, or *running* — and a
left edge in that outcome's colour. Records nothing bracketed (a subagent's turn,
a maintenance job) render as a flat strip between cards, which is the same
distinction `Journal.records` draws.

Colour is meaning, not decoration: who spoke tints the message, and an event
chip is coloured by its prefix, so `harpe.tools.*` reads differently from
`harpe.turn.*` at a glance.

The page polls once a second and appends what it has not seen, so a turn appears
as it happens. Filter from the header — it matches anywhere in a record, nested
fields included. `/` focuses the filter, `t` toggles turns-only, `f` toggles
follow.

The retained window is bounded by `capacity`. A busy process pushes its oldest
entries out, and the page says how many it lost rather than presenting the
remainder as the whole journal. Nothing is lost from the teed backend.

## In the CLI agent

The bundled CLI agent wires it, and leaves it off:

```sh
JOURNAL_PORT=8760 jo run
```

```
  journal · http://127.0.0.1:8760
```

Opt-in, because a terminal agent that opens a listening socket nobody asked for
is a surprise. It also builds the tee only when the port is set, so an unwatched
run keeps no second copy in memory.

## Reading it from the shell

The viewer reads the live process. The file the teed `JsonlLogger` wrote outlives
it, and is plain JSON lines, so `jq` reads a session that has already ended:

```sh
# every turn the user actually had, with its outcome
jq -c 'select(.event|startswith("harpe.turn.request","harpe.turn.response"))' session.jsonl

# what the agent ran, and how each program ended
jq -c 'select(.event=="harpe.tools.runCode.ran") | .fields | {exitCode, runSeconds}' session.jsonl

# token spend for the session
jq -s 'map(select(.event=="harpe.model.replied")) | {calls: length, input: (map(.fields.inputTokens)|add), output: (map(.fields.outputTokens)|add)}' session.jsonl

# anything that went wrong
jq -c 'select(.fields|has("error") or has("warning"))' session.jsonl
```

Pointing `Journal` at the same `Logger` the turn's tools use — which the bundled
drivers do — puts a tool's diagnostics in causal order beside the messages that
caused them: the `runCode` record lands between the assistant message that
requested it and the tool result that came back. That ordering is the reason to
keep one file rather than two, and it is a choice the driver makes, not
something the framework imposes.

## Before you expose it

The viewer serves the journal's contents to anyone who can reach it, and a
journal contains the full conversation: prompts, replies, tool output, file
names. It has **no authentication**.

That is why the framework binds nothing on its own. A driver that mounts the
routes on a server it already runs is publishing them to everyone that server
reaches, so gate them — the CLI agent's `JOURNAL_PORT` is one shape, an
environment switch checked in the route is another — and keep `Viewer.start` on
a loopback address. Reach a remote journal by tunnelling the port or copying the
file the teed backend wrote, not by opening one up.

## See also

- [Transcript](/concepts/transcript/) — how a conversation is recorded
- [Logging](/concepts/logging/) — the event stream and how to send it elsewhere
- [Deployment Checklist](/guides/production/) — what to keep and who may read it
