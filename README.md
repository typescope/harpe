# Harpe agents

Example agents for [Harpe](https://github.com/typescope/harpe), each a
`jo new` template.

## Getting started

```sh
jo new my-agent --template typescope/agents:web
cd my-agent
pip install -r requirements.txt
cp .env.example .env
jo start
```

## The agents

*These are demos and templates, not production software.*

| Template | What it shows |
|---|---|
| `hello` | The smallest complete agent. The whole loop is in `src/Main.jo` |
| `cli` | Terminal history, progress, cancellation, resumable sessions, logs |
| `web` | Browser sessions, streaming, uploads, downloadable files |
| `telegram` | Bot sessions, sender authorization, attachments |
| `pr-review` | A capability scoped to one external API |
| `flight-booker` | Human approval before an irreversible action |
