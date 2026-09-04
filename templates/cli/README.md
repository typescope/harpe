# cli

A terminal agent, with input history, progress, cancellation, resumable
sessions, and structured logs. It offers `runCode`, `runBash`, and the
read-only skill tools.

## Setup

```sh
pip install -r requirements.txt
cp .env.example .env
```

In `.env`, set `MODEL` and one provider key: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `OPENROUTER_API_KEY`. Set `OPENAI_BASE_URL` to reach
another Responses-API endpoint.

## Running

```sh
jo start
```

`jo resume` continues the previous session instead of starting a new one.

## Layout

- `AGENT.md` — the system prompt
- `src/` — the driver: loop, console, rendering
- `sandbox/` — the capabilities a generated program may call
- `skills/` — reference the model can read
