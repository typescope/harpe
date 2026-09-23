# telegram

A Telegram bot agent. It long-polls the Bot API, so nothing needs to be
publicly reachable. Each message is one turn, files the user sends are
downloaded for the agent to read, and the `sendFile` tool sends files back.
Turns for different chats run concurrently, and one chat's turns stay ordered.

## Setup

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

In `.env`:

- `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather), via
  `/newbot`
- `TELEGRAM_ALLOWED_SENDERS` — comma-separated user ids. Authorization is by
  sender, not chat. A bot is publicly reachable and this agent runs code, so
  access is closed by default: while this is empty, every message is rejected.
  DM the bot once and it replies with your user id.
- `MODEL` and one provider key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `OPENROUTER_API_KEY`

## Running

```sh
. .venv/bin/activate
jo start
```

## Layout

```text
telegram/
  prompts/
    SYSTEM.md
  src/
  sandbox/
  skills/
```
