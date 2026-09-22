# Harpe

[![CI](https://github.com/typescope/harpe/actions/workflows/ci.yml/badge.svg)](https://github.com/typescope/harpe/actions/workflows/ci.yml)
[![Release](https://img.shields.io/badge/release-v0.11.0-blue.svg)](https://github.com/typescope/harpe/releases/tag/v0.11.0)
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

Five ready-to-run agents live in [`templates/`](templates/), each a `jo new`
template that copies a complete project into your directory — sources, sandbox,
prompt, and, where it has them, its own tests.

| Template | Includes | Guide |
|---|---|---|
| `pdf-agent` | browser sessions, PDF uploads and OCR | [PDF Processing Agent](https://harpe.typescope.ai/examples/pdf-agent/) |
| `telegram` | bot sessions, sender authorization, attachments, and Telegram rendering | [Telegram Bot](https://harpe.typescope.ai/examples/telegram-bot/) |
| `pr-review` | a GitHub PR reviewer, behind a capability scoped to one external API | [GitHub PR Review](https://harpe.typescope.ai/examples/pr-review/) |
| `flight-booker` | a booking agent that asks a human before the irreversible step | [Flight Booking](https://harpe.typescope.ai/examples/flight-booker/) |

```sh
jo new my-agent --template typescope/harpe:pdf-agent
```

After creating one:

```sh
cd my-agent
pip install -r requirements.txt
cp .env.example .env
jo start
```

Each template's `.env.example` documents the variables it needs.

`smart-logistics` moved to its own repository,
[typescope/smart-logistics](https://github.com/typescope/smart-logistics), which is
cloned rather than created with `jo new`. Its
[case study](https://harpe.typescope.ai/case-studies/smart-logistics/) stays here.

Every manifest under `templates/` pins a published release rather than the
framework sources beside it, so a template builds as it stands and an API change
on `main` does not have to be made in five applications at once. The `cli/` agent
is not one of them — it builds from these sources, and is the framework's
end-to-end test subject.

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

Harpe requires Jo 0.13 or newer. See [CONTRIBUTING.md](CONTRIBUTING.md) to
contribute and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

MIT — see [LICENSE](LICENSE).
