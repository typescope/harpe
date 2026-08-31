# Harpe agents

Ready-to-run agents for [Harpe](https://github.com/typescope/harpe), each a
`jo new` template. Every one is a complete project: sources, sandbox, prompt,
requirements, and — where it has them — its own tests.

```sh
jo new my-agent --template typescope/agents:web
cd my-agent
pip install -r requirements.txt
cp .env.example .env
jo start
```

Each agent's `.env.example` documents the variables it needs.

## The agents

| Template | Kind | Includes |
|---|---|---|
| `hello` | start here | The smallest complete agent. No sessions, no skills, no tests — you can read the whole loop in `src/Main.jo` |
| `cli` | channel | Terminal history, progress, cancellation, resumable sessions, logs |
| `web` | channel | Browser sessions, streaming, uploads, downloadable files |
| `telegram` | channel | Bot sessions, sender authorization, attachments, Telegram rendering |
| `pr-review` | pattern | Reviews a GitHub PR through a capability scoped to one external API |
| `flight-booker` | pattern | Books a flight, with human approval before the irreversible step |

The **channel** agents differ only in how a person reaches them; pick the one
that matches where your users are. The **pattern** agents are worked examples —
read them for the shape, rather than starting from them.

## Tests

An agent that ships tests runs them from its own directory, against a scripted
model on localhost. No API key, and nothing reaches the network.

```sh
cd web
jo test
```

They are built on [`harpe-testing`](https://pkg.typescope.ai/harpe-testing.jsonl),
so they keep working in a project created with `jo new` — a starting point for
your own, rather than something to delete.

## Versions

Every agent here pins a published `harpe` release, so this repository is always
buildable as it stands. It moves one release at a time: a new `harpe` is
published first, then the agents are updated to it here. Tags match the `harpe`
release they were built against.

## Where things live

The framework itself — the turn engine, capabilities, models, tools — is in
[typescope/harpe](https://github.com/typescope/harpe), along with the
documentation and the `cli` agent, which doubles as that repository's end-to-end
test subject and is mirrored here at each release.

Issues about the framework belong upstream. Issues about an agent belong here.
