# Harpe

[![CI](https://github.com/typescope/harpe/actions/workflows/ci.yml/badge.svg)](https://github.com/typescope/harpe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v0.6.0-blue.svg)](https://github.com/typescope/harpe/releases/tag/v0.6.0)
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

Follow [Build Your First Agent](https://harpe.typescope.ai/tutorial/build-your-first-agent/)
to inspect each part.

## Start from an application

Harpe also ships three complete applications. Each template copies its source
into your project so you can inspect and customize it.

| Template | Includes | Guide |
|---|---|---|
| `cli` | terminal history, progress, cancellation, resumable sessions, and logs | [Create a CLI Agent](https://harpe.typescope.ai/tutorial/create-cli-agent/) |
| `web` | browser sessions, streaming, uploads, and downloadable files | [Create a Web Agent](https://harpe.typescope.ai/tutorial/create-web-agent/) |
| `telegram` | bot sessions, sender authorization, attachments, and Telegram rendering | [Create a Telegram Agent](https://harpe.typescope.ai/tutorial/create-telegram-agent/) |

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

Each template's `.env.example` documents the variables it needs.

## Documentation

The documentation is at [harpe.typescope.ai](https://harpe.typescope.ai).

- [Why Harpe?](https://harpe.typescope.ai/overview/why-harpe/)
- [Compile-time sandboxing](https://harpe.typescope.ai/overview/compile-time-sandboxing/)
- [Create a custom capability](https://harpe.typescope.ai/tutorial/create-custom-capabilities/)
- [Deployment checklist](https://harpe.typescope.ai/guides/production/)

## Development

Install the test dependencies and run the suite:

```sh
pip install -r requirements.txt
jo run test
```

Harpe requires Jo 0.12 or newer. See [CONTRIBUTING.md](CONTRIBUTING.md) to
contribute and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

MIT — see [LICENSE](LICENSE).
