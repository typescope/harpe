# hello

The smallest complete Harpe agent. No sessions or logs — the whole loop is in
`src/Main.jo`. It provides `runCode` and a Jo syntax skill.

## Setup

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

In `.env`, set `MODEL` and one provider key: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `OPENROUTER_API_KEY`.

## Running

```sh
. .venv/bin/activate
jo start
```

It reads a line, answers it, and repeats.

## Layout

```text
hello/
  prompts/
    SYSTEM.md
  src/
    Main.jo
  sandbox/
  skills/
```
