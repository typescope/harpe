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

Harpe ships a viewer for one session's journal. It is a module you declare, not
code you write:

```toml
[module.view]
kind = "app"
platform = "python"
enable-ffi = true
src = []
depth = 2

packages = [{ name = "harpe", version = "0.4" }]

links = [
  { from = "jo.main", to = "harpe.transcript.serve" },
]
```

`src = []` is deliberate: every line of the viewer is harpe's, linked in as this
module's entry point. The bundled drivers already declare it.

```sh
jo run view -- logs/sessions/20260821T091402-a3f1.jsonl
```

```
  20260821T091402-a3f1.jsonl
  Live at http://127.0.0.1:8760
  Ctrl-C to stop
```

`HOST` and `PORT` override the defaults.

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

## Reading it from the shell

The viewer is one reader; the file is plain JSON lines, so `jq` is another:

```sh
# every turn the user actually had, with its outcome
jq -c 'select(.event|startswith("harpe.turn.request","harpe.turn.response"))' session.jsonl

# what the agent ran, and how each program ended
jq -c 'select(.event=="harpe.tools.runCode.ran") | {exitCode, runSeconds}' session.jsonl

# token spend for the session
jq -s 'map(select(.event=="harpe.model.replied")) | {calls: length, input: (map(.inputTokens)|add), output: (map(.outputTokens)|add)}' session.jsonl

# anything that went wrong
jq -c 'select(has("error") or has("warning"))' session.jsonl
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

It binds `127.0.0.1` by default, which is what you want. Setting `HOST=0.0.0.0`
publishes a session's entire conversation to the network. Treat it as a
developer tool on a machine you control, and reach a remote journal by copying
the file or tunnelling the port rather than by opening one up.

## See also

- [Transcript](/concepts/transcript/) — how a conversation is recorded
- [Logging](/concepts/logging/) — the event stream and how to send it elsewhere
- [Deployment Checklist](/guides/production/) — what to keep and who may read it
