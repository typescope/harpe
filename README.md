# Harpe

[![CI](https://github.com/typescope/harpe/actions/workflows/ci.yml/badge.svg)](https://github.com/typescope/harpe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v0.11.0-blue.svg)](https://github.com/typescope/harpe/releases/tag/v0.11.0)
[![Docs](https://img.shields.io/badge/docs-harpe.typescope.ai-teal.svg)](https://harpe.typescope.ai)

Harpe is an agent framework for [Jo](https://jo-lang.org/).

A Harpe agent acts by writing typed Jo programs. Each program is compiled
against the capabilities you grant before it can run. Code that asks for an
unavailable capability does not compile.

> [!NOTE]
> Harpe is in developer preview and ready for serious experimentation.
> The public APIs are still stabilizing and may change between releases.

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

Set API key in `.env`, then run:

```sh
jo start
```

Follow [Build Your First Agent](https://harpe.typescope.ai/tutorial/build-your-first-agent/)
to inspect each part.

## Start from a template

| Template | Guide |
|---|---|
| `pdf-agent` | [PDF Processing Agent](https://harpe.typescope.ai/examples/pdf-agent/) |
| `telegram` | [Telegram Bot](https://harpe.typescope.ai/examples/telegram-bot/) |
| `pr-review` | [GitHub PR Review](https://harpe.typescope.ai/examples/pr-review/) |
| `flight-booker` | [Flight Booking](https://harpe.typescope.ai/examples/flight-booker/) |

## Documentation

- [Why Harpe?](https://harpe.typescope.ai/overview/why-harpe/)
- [Compile-time sandboxing](https://harpe.typescope.ai/overview/compile-time-sandboxing/)
- [Create a custom capability](https://harpe.typescope.ai/tutorial/create-custom-capabilities/)
- [Deployment checklist](https://harpe.typescope.ai/guides/production/)

