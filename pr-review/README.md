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
pip install -r requirements.txt
cp .env.example .env
```

In `.env`:

- `GITHUB_TOKEN` — a personal access token with the `repo` scope
- `MODEL` and one provider key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or
  `OPENROUTER_API_KEY`. OpenRouter has no default model, so `MODEL` is required
  with it.

## Running

```sh
jo review -- https://github.com/owner/repo/pull/123
```

That builds the sandbox guest and runs one turn.

## Layout

- `AGENT.md` — the system prompt, including what the review should and should
  not comment on
- `src/` — the driver
- `sandbox/` — the GitHub capability: `getPR`, `readFile`, `findDefinition`,
  and draft-only `saveDraftReview`
- `skills/` — reference the model can read

[Create a PR Review Agent](https://harpe.typescope.ai/tutorial/create-pr-review-agent/)
walks through how the capability boundary is built.
