+++
title = "Create a Telegram Agent"
+++
The Telegram template is a complete bot that long-polls Telegram, keeps
persistent state per chat, accepts attachments, and renders replies using
Telegram-compatible Markdown.

## Create the project

```sh
jo new my-agent --template typescope/harpe:telegram
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Follow Telegram's official
[bot tutorial](https://core.telegram.org/bots/tutorial#obtain-your-bot-token) to
create a bot and obtain its token. Then configure:

```sh
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_SENDERS=12345678
ANTHROPIC_API_KEY=...
```

The assistant is called **Carmen**. Use that name when registering the bot if
you want its Telegram profile and replies to match. You can rename it later in
Telegram and `AGENT.md`.

Access is closed by default. `TELEGRAM_ALLOWED_SENDERS` is a comma-separated
list of numeric Telegram user IDs. If an unlisted user messages the bot
privately, it replies with the ID you need to add.

Start the bot:

```sh
jo start
```

## What to customize

```text
my-agent/
  AGENT.md
  src/
    Telegram.jo          # startup, authorization, updates, and agent assembly
    TelegramClient.jo    # Telegram Bot API client
    Session.jo           # per-chat state, attachments, and persistence
    TelegramInteract.jo  # maps turn events to Telegram feedback
    Markdown.jo          # Telegram-safe reply rendering
  sandbox/
    SandboxAPI.jo
    SandboxRuntime.jo
    Task.jo
```

- Edit `AGENT.md` to define the bot's role.
- Keep `TELEGRAM_ALLOWED_SENDERS` narrow while developing: the bot can run
  model-written programs, so possession of its username must not imply access.
- Edit `src/Telegram.jo` to change the model, tools, context, budgets, commands,
  or authorization policy.
- Edit `src/Session.jo` to change attachment handling and persistence.
- Edit the sandbox to grant domain-specific capabilities.
