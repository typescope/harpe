# PR Review Agent

An AI agent that reviews GitHub Pull Requests and submits concise, signal-focused reviews — flagging only real problems (bugs, logic errors, security issues) and skipping style nits or filler praise.

## How it works

1. The agent receives a PR identifier and reads the diff and relevant source files via the GitHub API.
2. It writes a Jo program to inspect the PR and optionally fetch more context.
3. It submits a review (approve / request changes / comment) or merges the PR.

## Prerequisites

- [Jo](https://jo-lang.org) `0.12` compiler
- Python 3.10+
- GitHub personal access token with `repo` scope

## Setup

```sh
jo new my-reviewer --template typescope/harpe:pr-review
cd my-reviewer
pip install -r requirements.txt
```

Create a `.env` file with your tokens:

```sh
GITHUB_TOKEN=ghp_...
ANTHROPIC_API_KEY=sk-ant-...
```

The provider is selected by whichever key is present. Set `OPENAI_API_KEY` to
use OpenAI instead, or `OPENROUTER_API_KEY` together with `MODEL` to use
OpenRouter.

## Running

```sh
jo review -- https://github.com/owner/repo/pull/123
```

`jo review` builds the sandbox guest and then runs one turn. Reviews are
submitted as pending drafts by default, so nothing publishes until you approve
it in GitHub's interface.

## Customising the agent

- **Review philosophy** — edit `AGENT.md` to change what the agent focuses on.
- **GitHub API surface** — see `sandbox/API.jo` for available operations (`getPR`, `readFile`, `findDefinition`, `submitReview`, `addComment`, `merge`).
- **Jo syntax reference** — see `skills/jo-syntax.md`.

See [Create a PR Review Agent](https://harpe.typescope.ai/tutorial/create-pr-review-agent/)
for a walkthrough of how the capability boundary is built.
