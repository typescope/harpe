# hello

The smallest complete Harpe agent. No sessions, no skills, no logs — the whole
loop is in `src/Main.jo`, and `runCode` is its only tool.

## Setup

```sh
pip install -r requirements.txt
cp .env.example .env
```

In `.env`, set `MODEL` and one provider key: `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`.

## Running

```sh
jo start
```

It reads a line, answers it, and repeats.

## Layout

- `AGENT.md` — the system prompt
- `src/Main.jo` — the whole agent
- `sandbox/` — the capabilities a generated program may call
