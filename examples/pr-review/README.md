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
# Install Python dependencies
pip install -r requirements.txt

# Create a .env file with your tokens
cat > .env <<'EOF'
GITHUB_TOKEN=ghp_...

# LLM provider (anthropic is the default)
ANTHROPIC_API_KEY=sk-ant-...

# To use OpenAI instead:
# PROVIDER=openai
# OPENAI_API_KEY=sk-...
EOF
```

## Running

```sh
# Review a PR and post the review (pending by default) to GitHub
jo review -- https://github.com/owner/repo/pull/123

## Customising the agent

- **Review philosophy** — edit `AGENT.md` to change what the agent focuses on.
- **GitHub API surface** — see `sandbox/API.jo` for available operations (`getPR`, `readFile`, `submitReview`, `addComment`, `merge`).
- **Jo syntax reference** — see `skills/jo-syntax.md`.
