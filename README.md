# Harpe

[![CI](https://github.com/typescope/harpe/actions/workflows/ci.yml/badge.svg)](https://github.com/typescope/harpe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v0.1.0-blue.svg)](https://github.com/typescope/harpe/releases/tag/v0.1.0)
[![Docs](https://img.shields.io/badge/docs-harpe.typescope.ai-teal.svg)](https://harpe.typescope.ai)

Harpe is an agent framework for [Jo](https://jo-lang.org/).

A Harpe agent acts by writing typed Jo programs. Each program is compiled
against the capabilities you grant before it can run. Code that asks for an
unavailable capability does not compile.

## Quick start

Install Jo:

```sh
curl -sSf https://jo-lang.org/install.sh | sh
```

Create the minimal learning agent:

```sh
jo new my-agent --template typescope/harpe:hello
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` in `.env`,
then run. OpenRouter also requires `MODEL`:

```sh
jo start
```

The `hello` application is intentionally small. Its terminal interaction has no
spinner, cancellation, sessions, or media handling. You can read the complete
agent loop in `src/Main.jo`.

Follow [Build Your First Agent](docs/content/tutorial/build-your-first-agent.md)
to inspect each part.

## Start from an application

Harpe also ships three complete applications. Each template copies its source
into your project so you can inspect and customize it.

| Template | Includes | Guide |
|---|---|---|
| `cli` | terminal history, progress, cancellation, resumable sessions, memory, and logs | [Create a CLI Agent](docs/content/tutorial/create-cli-agent.md) |
| `web` | browser sessions, streaming, uploads, and downloadable files | [Create a Web Agent](docs/content/tutorial/create-web-agent.md) |
| `telegram` | bot sessions, sender authorization, attachments, and Telegram rendering | [Create a Telegram Agent](docs/content/tutorial/create-telegram-agent.md) |

```sh
jo new my-agent --template typescope/harpe:cli
jo new my-agent --template typescope/harpe:web
jo new my-agent --template typescope/harpe:telegram
```

After creating one:

```sh
cd my-agent
pip install -r requirements.txt
cp .env.example .env
jo start
```

The web application listens on `http://127.0.0.1:8765` by default.

The Telegram application also needs `TELEGRAM_BOT_TOKEN` and a comma-separated
`TELEGRAM_ALLOWED_SENDERS` list. It uses long polling, so it does not need a
public HTTP endpoint.

## Documentation

- [Agent concepts](docs/content/concepts/agent.md)
- [Sandbox architecture](docs/content/concepts/sandbox.md)
- [Create a custom capability](docs/content/tutorial/create-custom-capabilities.md)
- [Add defense in depth](docs/content/tutorial/defense-in-depth.md)
- [Tools](docs/content/concepts/tools.md)
- [Human approval](docs/content/concepts/approvals.md)
- [Context](docs/content/concepts/context.md)
- [Memory](docs/content/concepts/memory.md)
- [Skills](docs/content/concepts/skills.md)
- [Media](docs/content/concepts/media.md)
- [Logging](docs/content/concepts/logging.md)

## Development

Install the test dependencies and run the suite:

```sh
pip install -r requirements.txt
jo run test
```

Harpe requires Jo 0.12 or newer.
