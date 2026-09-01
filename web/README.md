# web

A browser agent. It serves a local chat page and runs one turn per message,
streaming progress as it goes. Uploads and downloadable files are supported.

## Setup

```sh
pip install -r requirements.txt
cp .env.example .env
```

In `.env`, set `MODEL` and one provider key: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `OPENROUTER_API_KEY`. `HOST` and `PORT` are optional and
default to `127.0.0.1` and `8765`.

## Running

```sh
jo start
```

Then open <http://127.0.0.1:8765>.

`jo test` runs the end-to-end suite: it starts the agent as its own process and
drives it over HTTP against a scripted model, so it needs no API key and
reaches no network.

## Layout

- `AGENT.md` — the system prompt
- `src/` — the driver: server, sessions, rendering
- `assets/` — the chat page
- `sandbox/` — the capabilities a generated program may call
- `skills/` — reference the model can read
- `tests/` — the end-to-end suite
