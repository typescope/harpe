# Harpe templates

Five ready-to-run agents, each a `jo new` template that copies a complete project
into your directory — sources, sandbox, prompt, and, where it has them, its own
tests.

## Getting started

```sh
jo new my-agent --template typescope/harpe:pdf-agent
cd my-agent
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
jo start
```

`jo-templates.jsonl` at the repository root is what names these and maps each to
its directory here.

## Developing with a coding assistant

Each template includes an `AGENTS.md` with development commands and constraints.
It also links to Jo and Harpe documentation and source.
This file is copied into the scaffolded project. Keep it current as you develop it.
Runtime agent instructions live in `prompts/SYSTEM.md`.

## The agents

*These are demos and templates, not production software.*

| Template | What it shows |
|---|---|
| `hello` | The smallest complete agent. The whole loop is in `src/Main.jo` |
| `pdf-agent` | Browser sessions, streaming, PDF uploads and OCR |
| `telegram` | Bot sessions, sender authorization, attachments |
| `pr-review` | A capability scoped to one external API |
| `flight-booker` | Human approval before an irreversible action |

`smart-logistics` moved to
[typescope/smart-logistics](https://github.com/typescope/smart-logistics). It is
cloned rather than created with `jo new`.

Every manifest here pins a published release rather than building from the
sources beside it, so a template builds in a user's directory as it stands, and
an API change on `main` does not have to be made in five applications at once.
Retargeting them to a new release is a step in [RELEASE.md](../RELEASE.md).
