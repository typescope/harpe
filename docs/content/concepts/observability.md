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

`Viewer` serves that tail as one route:

```jo
case Http.Get("/journal") => Viewer.respond(tail, title)
```

An entry is visible the moment it is logged — no flush, no second process, no
path to agree on.

That one route is the whole integration. It answers with the page, or — when
the page polls it back with the cursor it has reached — with the entries after
it. The page is one self-contained response, so there is no stylesheet or
script URL to route either: you choose a path, and the protocol stays between
the page and the viewer. An agent with no HTTP server of its own takes
`Viewer.start` instead, which binds a port on a daemon thread:

```jo
Viewer.start(tail, title, "127.0.0.1", port)
```

That server is quiet: the page polls once a second, and `wsgiref` would
otherwise write an access line per poll into whatever terminal the agent is
using. Mounting the route on a server of your own, call `Http.quiet(httpd)` if
you want the same. Unhandled exceptions still surface either way.

The framework provides the mechanism and stops there. Whether to expose a
journal, on which port, behind which path, and to whom is a driver's decision —
see [Before you expose it](#before-you-expose-it).

## Lanes

The page groups by **structure alone**. A record's `context` **is** its path from
the root — outermost scope first, the one that produced the record last — and a
**lane is a path prefix**:

- the leftmost lane is the empty prefix — every record, in arrival order
- clicking a scope on a row opens a lane holding that scope's records and
  everything nested under it
- a lane one level deeper sits to its right: `all › session › turn › tool call`

![The viewer drilling into a live journal. It opens on one lane, "all", holding every record in arrival order. Clicking a turn's scope opens a second lane beside it with that turn's records; clicking the tool call inside it opens a third. A second turn, opened from the leftmost lane, appears as a new row below rather than replacing anything, so both turns stay open at once. A record's raw JSON opens in a panel over the page.](/img/journal-lanes.gif)

Nothing else decides what a lane contains. No event name, no scope key, no
record's position — so a producer can invent scopes forever and they nest
correctly without the viewer learning about them. Concurrent conversations are
handled by narrowing rather than by guessing, and nesting by drilling.

**Opening a context never closes another.** The lanes are a tree laid out as a
grid: a branch is a row, a scope's depth is its column, and the root spans them
all. Drilling deeper grows a row rightward; opening something off that path
starts a row of its own below, so two deep contexts stay side by side and
comparable — one session's turn against another's.

Each row carries its innermost scope as a chip on a line of its own beneath the
record — a path is arbitrary text, and beside the record it took the width the
record needed. The chip is relative to its lane, since the lane is already its
prefix, so a record sitting at its lane's own level carries none; the caret opens
the rest of the path, and any chip on it opens that level. Clicking a context that is already on screen highlights it
rather than opening it twice. A lane's ✕ closes it and the rest of its own row,
and Escape closes the most recently opened lane.

This is why the viewer is worth pointing at a journal that is not an agent
conversation at all: it knows nothing about turns, so it groups any log whose
records carry scopes.

It asks nothing of a log that the format does not already guarantee: a scope
**is** a string identity — `"harpe.turn.id=209b1e14"` — so being stable for its
unit of work and distinct between instances is what the type means, not a
convention a producer might miss. The one case no viewer can untangle is a
driver running concurrent exchanges under *no* scope, because the log did not
record which is which.

## What a row shows

Records render by what they carry, and every bit of that is presentation that
falls back: a message reads as speech, a tool result as its contents, and
anything else as its fields. Colour is meaning rather than decoration — who
spoke tints the message, and an event is tinted by its prefix, so
`harpe.tools.*` reads differently from `harpe.turn.*` at a glance. None of it
decides where a record goes.

A field's value may itself be a tree — `Value` nests maps and lists — and reads
as one: a line per entry, indented by depth, with no braces or quotes in the way.
A branch shows what it holds (`{4}`, `[2]`) and opens when you ask, so a record
with a deep field stays a line or two until you want it.

Hovering a row reveals a `{...}` button that opens the record as the server sent
it, with the path it sits at. What a lane contains is derived, so this is how you
tell a wrong grouping from a wrong log.

The page polls once a second and appends what it has not seen, so a record
appears as it happens. Filter from the header — it matches anywhere in a record,
nested fields included, and applies to every lane. `/` focuses the filter, `f`
toggles follow.

Following keeps up with the end rather than dragging you there: a lane you have
scrolled back through holds its place, and resumes following when you return to
the end. A lane you just opened starts at the *beginning* of that context, since
that is what you asked to see — only the leftmost lane, which is a tail rather
than a context, opens at the newest record.

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

# every shell command the CLI agent ran, with its status
jq -r 'select(.event=="harpe.tools.runBash.ran") | .fields | "\(.exitCode)\t\(.command)"' session.jsonl

# token spend for the session
jq -s 'map(select(.event=="harpe.metering.usage")) | {calls: length, input: (map(.fields.inputTokens)|add), output: (map(.fields.outputTokens)|add)}' session.jsonl

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
