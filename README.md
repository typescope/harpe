# Harpe agents

Six example agents for [Harpe](https://github.com/typescope/harpe), each a
`jo new` template.

These are demos and templates, not production software. They are written to be
read and copied. Review anything you keep from them, and expect to change it.

## Getting started

```sh
jo new my-agent --template typescope/agents:web
cd my-agent
pip install -r requirements.txt
cp .env.example .env
jo start
```

Each agent's `.env.example` lists the variables it reads. The run command is
declared in its `jo.toml` under `[commands]`: `jo start` for all of them except
`pr-review`, which takes a PR URL and uses `jo review`.

## The agents

| Template | Kind | What it shows |
|---|---|---|
| `hello` | start here | The smallest complete agent. The whole loop is in `src/Main.jo` |
| `cli` | channel | Terminal history, progress, cancellation, resumable sessions, logs |
| `web` | channel | Browser sessions, streaming, uploads, downloadable files |
| `telegram` | channel | Bot sessions, sender authorization, attachments |
| `pr-review` | pattern | A capability scoped to one external API |
| `flight-booker` | pattern | Human approval before an irreversible action |

The channel agents differ in how a person reaches them. The pattern agents show
one technique each.

## Tests

`web` ships an end-to-end suite. It builds the agent, starts it as its own
process, and drives it over HTTP against a scripted model, so it needs no API
key and reaches no network.

```sh
cd web
jo test
```

It is built on [`harpe-testing`](https://pkg.typescope.ai/harpe-testing.jsonl),
which a project created with `jo new` can use as well. The other five agents
have no tests.

## Versions

Every agent pins a published `harpe` release, so this repository builds as it
stands. A new `harpe` is published first, then the agents are updated to it
here. Tags match the `harpe` release they were built against.

## Where things live

The framework — the turn engine, capabilities, models, tools — and the
documentation are in
[typescope/harpe](https://github.com/typescope/harpe). The `cli` agent lives
there too, as that repository's end-to-end test subject, and is mirrored here at
each release.

Issues about the framework belong upstream. Issues about an agent belong here.
