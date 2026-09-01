# pr-review

Reviews one GitHub pull request and submits the review. It reaches GitHub only
through the capability in `sandbox/API.jo`, so the model never sees the token.
Reviews are submitted as pending drafts by default, so nothing publishes until
you approve it in GitHub.

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
  `submitReview`, `addComment`, `merge`
- `skills/` — reference the model can read

[Create a PR Review Agent](https://harpe.typescope.ai/tutorial/create-pr-review-agent/)
walks through how the capability boundary is built.
