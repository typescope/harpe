# pr-review

This agent demonstrates **REST API surface narrowing**, a strong point of Jo's
capability model. A conventional process sandbox can block or allow network
access, but cannot naturally grant selected operations from one REST API while
making its sibling endpoints uncallable. Here the trusted implementation can
use GitHub's broader API, while model-written programs receive only four typed
operations, with the sole write restricted to saving a pending draft.

The agent reviews one GitHub pull request and saves the draft for manual
verification. It reaches GitHub only through the capability in `sandbox/API.jo`,
so the model never sees the token and cannot publish, comment, or merge.

## Setup

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

In `.env`:

- `GITHUB_TOKEN` — a personal access token with the `repo` scope
- `MODEL` and one provider key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `OPENROUTER_API_KEY`. OpenRouter has no default model, so `MODEL` is required
  with it.

## Running

```sh
. .venv/bin/activate
jo review -- https://github.com/owner/repo/pull/123
```

The startup output prints a local log viewer URL, normally
<http://127.0.0.1:8766>. Set `VIEW_HOST` or `VIEW_PORT` to change it. The
command builds the sandbox guest and runs one turn.

## Layout

```text
pr-review/
  prompts/
    SYSTEM.md
  src/
  sandbox/
  skills/
```

[GitHub PR Review](https://harpe.typescope.ai/examples/pr-review/) walks
through how the capability boundary is built.
