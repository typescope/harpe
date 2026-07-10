+++
title = "Build a Request-Driven Agent"
weight = 3
+++
We'll build a **GitHub PR reviewer**: when a pull request opens, GitHub calls our agent
over HTTP, the agent reads the diff, runs the tests, and posts a review comment.

```
GitHub ── POST /review {pr: 482} ──▶ agent
                                      │ reads diff, runs tests,
                                      │ writes findings
   200 OK ◀───────────────────────────┘ posts a review comment on the PR
```

A request-driven agent is the same Jo project as a
[conversational](@/tutorial/conversational-agent.md) one — it just wakes on an incoming request instead
of a chat message, does its work, and returns. The request is usually an HTTP call (what we
build here), but it can be any one-shot event a loop delivers, such as an inbound email.
**No human is in the loop**: a webhook fires it, possibly hundreds of times a day. So security is entirely the **capabilities you grant
at build time**, and oversight is the **audit log** — there's no one to pause and ask.

> New to Harpe? Build the [hello-world agent](@/tutorial/_index.md) first, and keep
> [Concepts](@/tutorial/concepts.md) handy for the why.

## The whole thing

The agent's capabilities are its entry-point contract in `sandbox/api`:

```jo
// sandbox/api/src/Entry.jo — what the PR reviewer can do
defer def runTask(): Unit receives github, tests
```

`github` is a published capability (read PRs, post comments). `tests` is a tiny one you write
inline — an interface in `sandbox/api` and an implementation in `sandbox/runtime` that runs exactly
`make test`. The top-level `jo.toml` pulls in the Harpe loop and points `main` at its HTTP
loop (`Harpe.http`) — that's the trigger — so `jo run` serves the agent with no source
files; the route and tokens live in `.env`. All from the template.

```sh
jo new pr-reviewer --template request-driven
cd pr-reviewer
claude                 # "review PRs: read the diff, run make test, post a comment"
jo run                 # starts a local server on http://localhost:8787
```

## Step 1 — Scaffold

```sh
jo new pr-reviewer --template request-driven
cd pr-reviewer
```

Same shape as always — the `jo.toml` agent app, the `sandbox/{api, runtime, guest}`
projects, `AGENT.md`, `skills/`, `.env.example`, `data/`, `logs/`, and the `CLAUDE.md` +
`.claude/skills/` that let Claude Code finish the agent for you. The steps below are what
Claude does — and what you'd type by hand.

## Step 2 — The trigger

A request-driven agent takes a turn whenever **an HTTP request arrives**. Point `main` at
Harpe's HTTP loop in `jo.toml`, and name the route in `.env`; the request body becomes the
agent's input:

```toml
# jo.toml
[main.links]
"jo.main" = "Harpe.http"
```
```sh
# .env
ROUTE=POST /review
```

`jo run` serves this on `http://localhost:8787` so you can test with `curl` before
exposing it.

## Step 3 — Grant capabilities (narrow ones)

With no human watching, the capability set you grant *is* the entire security boundary —
so the work is to grant capabilities narrow enough to be safe on their own. This agent gets
two:

- **`github`** — a published capability that reads PR diffs and posts comments. Depend on it
  from `sandbox/api` (the interface) and `sandbox/runtime` (the implementation), and put its
  token in `.env`:

  ```toml
  # sandbox/api/jo.toml          # sandbox/runtime/jo.toml gets github-runtime (link = true)
  [main.dependencies]
  github = "2.1"
  ```
  ```sh
  # .env
  GITHUB_TOKEN=ghp_...
  ```

- **`tests`** — run the project's test command. You *could* reach for raw `shell`, but that
  grants "run **anything**" — far too broad for an unattended webhook. Instead write a tiny
  bespoke capability whose interface offers one method, and whose runtime runs exactly one
  command:

  ```jo
  // sandbox/api/src/Tests.jo — the whole authority: run the suite, nothing else
  interface Tests
    def run(): TestResult
  end
  param tests: Tests
  ```
  ```jo
  // sandbox/runtime/src/TestsImpl.jo
  class TestsImpl()
    def run(): TestResult = Shell.run("make test")     // fixed command — not the model's choice
    view Tests
  end
  ```

  Its *type* makes running anything else impossible — no review needed. This is the whole
  game: **narrow the capability instead of supervising its use.**

Add both to the entry point and type-check:

```jo
// sandbox/api/src/Entry.jo
defer def runTask(): Unit receives github, tests
```
```sh
jo check --spec sandbox/api/jo.toml      # the interfaces compile
```

To see what a capability lets the agent do, read its interface with `jo doc --spec
sandbox/api/jo.toml`.

## Step 4 — Teach it

**`AGENT.md`** — what a good review looks like, in your team's voice:

```markdown
# PR Reviewer

You review pull requests for the payments service.

- Run the test suite; if it fails, lead with that.
- Flag missing tests for new branches, and any TODO left in the diff.
- Be specific and kind: cite file:line, suggest a fix, don't nitpick style the
  linter already covers.
- Keep the summary under 8 bullet points.
```

**`skills/`** — repo-specific knowledge it can look up:

```markdown
<!-- skills/conventions.md -->
# Repo Conventions

- Tests: `make test`. A green run prints `OK (n tests)`.
- Every public function needs a doc comment.
- Migrations must ship with a rollback.
```

## Step 5 — The input

The HTTP body is handed to the agent as its request. For a GitHub webhook that's the PR
event; the `github` capability lets it fetch whatever else it needs from the PR number. A
minimal test payload:

```json
{ "pr": 482 }
```

## Step 6 — Run and test

```sh
jo run
```

```sh
curl -s localhost:8787/review -d '{"pr": 482}'
```

The agent writes a program, `jo` runs it, and it posts the review — no pause, because
every capability it uses (`github`, `tests`) is already bounded by its type:

```
✓ posted review on PR #482  (tests passed; flagged 2 missing tests)
```

```jo
def runTask(): Unit receives github, tests, skills =
  val diff   = github.diff(482)
  val result = tests.run()                 // ← can only run `make test`
  val review = compose(diff, result, skills.read("conventions"))
  github.comment(482, review)
```

There's no human to approve anything here, and there doesn't need to be: `tests` can't run
anything but `make test`, and `github` can't touch any repo but the one it's scoped to.
The security review happened **once, when you chose and bounded these capabilities** — not
per PR. To audit what actually ran, read the audit log under `logs/` — every turn's
program, inputs, and effects are recorded there.

## Step 7 — Go live

Run the same project on a host that's reachable from GitHub (`jo run` under the `http`
trigger, kept alive by your process manager — the runtime serves the route). Point a GitHub
webhook (PR *opened* / *synchronize*) at `https://<your-host>/review`, and every new PR
gets reviewed automatically.

## How it works

Same engine as every Harpe agent: the model's only tool is **write a Jo program**, and its
authority is exactly the capability set you granted — proven by the compiler, so it holds
for every one of the thousands of requests with no one watching. The HTTP request is just
what *triggers* the turn; there's no session to carry forward — one request in, one result
out. Because no human is in the loop, the rule is simple: **grant only capabilities narrow
enough to be safe unattended, and read the audit log.** See
[how a turn works](@/tutorial/concepts.md#how-a-turn-works) for the full picture.

## Next steps

- [Monitoring agent](@/tutorial/monitoring-agent.md) — same project, applied to a scheduled monitor.
- [Conversational agent](@/tutorial/conversational-agent.md) — if you skipped it, it's the gentlest intro.
- [Create a custom capability](@/tutorial/create-custom-capabilities.md) — wrap your own internal API as a capability.
- [Concepts](@/tutorial/concepts.md) — the model underneath all three.
