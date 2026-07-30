+++
title = "Create a Telegram Agent"
weight = 4
+++
The Telegram template is a complete bot that long-polls Telegram, keeps
persistent state per chat, accepts attachments, and renders replies using
Telegram-compatible Markdown. It does not require a public HTTP endpoint.

## Create the project

```sh
jo new my-agent --template typescope/harpe:telegram
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Create a bot with Telegram's `@BotFather`, then configure:

```sh
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_SENDERS=12345678
ANTHROPIC_API_KEY=...
```

Access is closed by default. `TELEGRAM_ALLOWED_SENDERS` is a comma-separated
list of numeric Telegram user IDs. If an unlisted user messages the bot
privately, it replies with the ID you need to add.

Start the bot:

```sh
jo start
```

## Make the first change

If you do not know your numeric Telegram ID, leave
`TELEGRAM_ALLOWED_SENDERS` empty for the first run and message the bot in a
private chat. It will reject the message and tell you the sender ID. Add that
number to `.env`, restart the bot, and send another message.

Then edit the opening of `AGENT.md`:

```markdown
# Team Assistant

You help our engineering team answer operational questions.
Keep Telegram replies short and put commands in code blocks.
```

Restart the bot and ask it to introduce itself. Its answer should reflect the
new role. This confirms the token, sender authorization, model, and prompt are
all wired correctly before you add capabilities.

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

The Telegram client and polling loop are copied into your project deliberately:
you can audit the network boundary and change it when the application needs
webhooks, group-specific policy, or another deployment model.

Next: [create a custom capability](/tutorial/create-custom-capabilities/).
