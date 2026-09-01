# Harpe agents

Example agents for [Harpe](https://github.com/typescope/harpe), each a
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

| Template | What it shows |
|---|---|
| `hello` | The smallest complete agent. The whole loop is in `src/Main.jo` |
| `cli` | Terminal history, progress, cancellation, resumable sessions, logs |
| `web` | Browser sessions, streaming, uploads, downloadable files |
| `telegram` | Bot sessions, sender authorization, attachments |
| `pr-review` | A capability scoped to one external API |
| `flight-booker` | Human approval before an irreversible action |
