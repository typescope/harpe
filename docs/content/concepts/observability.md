+++
title = "Observability"
+++
If a flower blooms and fades in a valley and no one is around to see it, does it
exist?

That is the same fate of [logs](/concepts/logging/): without being seen and
audited, they are dead. Observability makes dead logs alive.

## Three properties

The **log viewer** shows logs live in a browser. Unlike traditional linear logs,
it presents them structurally and contextually:

- **Structural.** A record is structured data, so it is shown as structure rather
  than as text. A field holding a nested map or list becomes an interactive tree.

- **Contextual.** A record's `context` is its path from the root, and a lane is a
  path prefix. Focus on a user, a session or a turn in a lane of its own, several
  at once.

- **Content-agnostic.** The viewer assumes only the structure of the logging
  framework, never the content of logging items. It works wherever the logging
  does, whatever the events and scopes are called.

## Lanes

A record's `context` **is** its path from the root — outermost scope first, the
one that produced the record last — and the lanes are that path's **prefixes**:

- the leftmost lane is the empty prefix — every record, in arrival order
- clicking a scope on a row opens a lane holding that scope's records and
  everything nested under it
- a lane one level deeper sits to its right: `all › session › turn › tool call`

![The viewer drilling into a live journal. It opens on one lane, "all", holding every record in arrival order. Clicking a turn's scope opens a second lane beside it with that turn's records, and clicking the tool call inside it opens a third. A second turn, opened from the leftmost lane, appears as a new row below rather than replacing anything, so both turns stay open at once. A record's raw JSON opens in a panel over the page.](/img/journal-lanes.gif)

## Integrate the log viewer

`ViewLogger` is a `Logger` that keeps the last `capacity` entries in memory and
lets them be read back. Tee it beside the backend you already had, so the file
still gets everything:

```jo
val viewLog = new ViewLogger(capacity = 5000)
val log     = new TeeLogger([new JsonlLogger(sessionPath), viewLog])
```

`Viewer` serves that window as one route:

```jo
case Http.Get("/journal") => Viewer.respond(viewLog, title)
```

An entry is visible the moment it is logged — no flush, no second process, no
path to agree on.

That one route is the whole integration: it answers with the page, and with the
entries after the cursor when the page polls back. The page is self-contained, so
there is nothing else to route.

An agent with no HTTP server of its own takes `Viewer.start` instead, which binds
a port on a daemon thread:

```jo
Viewer.start(viewLog, title, "127.0.0.1", port)
```

The framework provides the mechanism and stops there. Whether to expose a
journal, on which port, behind which path, and to whom is a driver's decision —
see [Before you expose it](#before-you-expose-it).

## Reading it from the shell

The viewer reads the live process. The file the teed `JsonlLogger` wrote outlives
it, and is plain JSON lines, so `jq` reads a session that has already ended:

```sh
# every turn the user actually had, with its outcome
jq -c 'select(.event|startswith("harpe.turn.request","harpe.turn.response"))' session.jsonl

# what the agent ran, and how each program ended
jq -c 'select(.event=="harpe.tools.runCode.ran") | .fields | {exitCode, runSeconds}' session.jsonl

# token spend for the session
jq -s 'map(select(.event=="harpe.metering.usage")) | {calls: length, input: (map(.fields.inputTokens)|add), output: (map(.fields.outputTokens)|add)}' session.jsonl

# anything that went wrong
jq -c 'select(.fields|has("error") or has("warning"))' session.jsonl
```

Pointing `Journal` at the same `Logger` the turn's tools use puts a tool's
diagnostics in causal order beside the messages that caused them: the `runCode` record lands between the assistant message that
requested it and the tool result that came back. That ordering is the reason to
keep one file rather than two, and it is a choice the driver makes, not
something the framework imposes.

## Before you expose it

The viewer serves the journal's contents to anyone who can reach it, and a
journal contains the full conversation: prompts, replies, tool output, file
names. It has **no authentication**.

That is why the framework binds nothing on its own. A driver that mounts the
route on a server it already runs is publishing it to everyone that server
reaches, so gate it — an environment switch checked before the route is one
shape — and keep `Viewer.start` on a loopback address. Reach a remote journal by
tunnelling the port or copying the file the teed backend wrote, not by opening
one up.

## See also

- [Transcript](/concepts/transcript/) — how a conversation is recorded
- [Logging](/concepts/logging/) — the event stream and how to send it elsewhere
- [Deployment Checklist](/guides/production/) — what to keep and who may read it
