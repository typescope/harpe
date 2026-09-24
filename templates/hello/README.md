# hello

The smallest complete Harpe agent. The whole loop is in `src/Main.jo`; it also
shows an in-memory live log. It provides `runCode` and a Jo syntax skill.

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

The startup output prints a local log viewer URL, normally
<http://127.0.0.1:8766>. Set `VIEW_HOST` or `VIEW_PORT` to change it. It reads
a line, answers it, and repeats.

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
