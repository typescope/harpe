# Harpe templates

Six ready-to-run agents, each a `jo new` template that copies a complete project
into your directory — sources, sandbox, prompt, and, where it has them, its own
tests.

## Getting started

```sh
jo new my-agent --template typescope/harpe:web
cd my-agent
pip install -r requirements.txt
cp .env.example .env
jo start
```

`jo-templates.jsonl` at the repository root is what names these and maps each to
its directory here.

## The agents

*These are demos and templates, not production software.*

| Template | What it shows |
|---|---|
| `hello` | The smallest complete agent. The whole loop is in `src/Main.jo` |
| `web` | Browser sessions, streaming, uploads, downloadable files |
| `telegram` | Bot sessions, sender authorization, attachments |
| `pr-review` | A capability scoped to one external API |
| `flight-booker` | Human approval before an irreversible action |
| `smart-logistics` | Two agents, two capability grants, and policy written as prose |

Every manifest here pins a published release rather than building from the
sources beside it, so a template builds in a user's directory as it stands, and
an API change on `main` does not have to be made in six applications at once.
Retargeting them to a new release is a step in [RELEASE.md](../RELEASE.md).
