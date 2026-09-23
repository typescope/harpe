# hello

The smallest complete Harpe agent. No sessions or logs — the whole loop is in
`src/Main.jo`. It provides `runCode` and a Jo syntax skill.

## Setup

```sh
pip install -r requirements.txt
cp .env.example .env
```

In `.env`, set `MODEL` and one provider key: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `OPENROUTER_API_KEY`.

## Running

```sh
jo start
```

It reads a line, answers it, and repeats.

## Layout

- `prompts/`
  - `SYSTEM.md` — the runtime system prompt
- `src/Main.jo` — the whole agent
- `sandbox/` — the capabilities a generated program may call
- `skills/` — Jo syntax guidance the agent can read on demand
