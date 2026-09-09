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
case Http.Get("/journal")        => Viewer.respondPage(title, "/journal/events")
case Http.Get("/journal/events") => Viewer.respondEvents(tail)
```

An entry is visible the moment it is logged — no flush, no second process, no
path to agree on.

Those two routes are the whole integration. The page is one self-contained
response, so there is no stylesheet or script URL to route, and the `seen`
cursor and envelope the two exchange stay between them — you choose the paths
and nothing else. An agent with no HTTP server of its own takes `Viewer.start`
instead, which binds a port on a daemon thread:

```jo
val _ = Viewer.start(tail, title, "127.0.0.1", port)
```

That server is quiet: the page polls once a second, and `wsgiref` would
otherwise write an access line per poll into whatever terminal the agent is
using. Mounting the routes on a server of your own, call `Http.quiet(httpd)` if
you want the same. Unhandled exceptions still surface either way.

The framework provides the mechanism and stops there. Whether to expose a
journal, on which port, behind which path, and to whom is a driver's decision —
see [Before you expose it](#before-you-expose-it).

## Lanes

The page groups by **structure alone**. A record's `context` is its scope chain
innermost-first, so reversed it is the path from the root, and a **lane is a path
prefix**:

- the leftmost lane is the empty prefix — every record, in arrival order
- clicking a scope on a row opens a lane holding that scope's records and
  everything nested under it
- a lane one level deeper sits to its right: `all › session › turn › tool call`

Nothing else decides what a lane contains. No event name, no scope key, no
record's position — so a producer can invent scopes forever and they nest
correctly without the viewer learning about them. Concurrent conversations are
handled by narrowing rather than by guessing, and nesting by drilling.

**Opening a context never closes another.** The lanes are a tree laid out as a
grid: a branch is a row, a scope's depth is its column, and the root spans them
all. Drilling deeper grows a row rightward; opening something off that path
starts a row of its own below, so two deep contexts stay side by side and
comparable — one session's turn against another's.

Each row carries its innermost scope as a chip, relative to its lane, since the
lane is already its prefix; the caret opens the rest of the path, and any chip on
it opens that level. Clicking a context that is already on screen highlights it
rather than opening it twice. A lane's ✕ closes it and the rest of its own row,
and Escape closes the most recently opened lane.

This is why the viewer is worth pointing at a journal that is not an agent
conversation at all: it knows nothing about turns, so it groups any log whose
records carry scopes.

The one thing it asks of a log is that **a scope be an identity** — stable for
its unit of work and distinct between instances, which is the convention
[`Entry`](/concepts/logging/) already describes. A driver that runs concurrent
exchanges under *no* scope cannot be untangled by any viewer, because the log
did not record which is which.

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
