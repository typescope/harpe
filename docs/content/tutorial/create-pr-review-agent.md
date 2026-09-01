+++
title = "Create a PR Review Agent"
+++
The PR review example is a complete agent that reviews a GitHub pull request and
submits the review. It reads the diff, follows identifiers into the repository
snapshot, and saves a pending draft — all by writing Jo programs against a
GitHub capability that offers four operations and nothing else.

## Create the project

```sh
jo new my-reviewer --template typescope/agents:pr-review
cd my-reviewer
pip install -r requirements.txt
```

Copy the example environment file, and fill in a GitHub personal access token
carrying the `repo` scope, plus one model provider key:

```sh
cp .env.example .env
```

```sh
GITHUB_TOKEN=...
ANTHROPIC_API_KEY=...
```

Set `OPENAI_API_KEY` instead to use OpenAI. To use OpenRouter, set
`OPENROUTER_API_KEY` and `MODEL`. The provider is chosen by which key is
present.

Review a pull request:

```sh
jo review -- https://github.com/owner/repo/pull/123
```

`jo review` builds the sandbox guest and then runs a single turn. The agent
prints each tool call as it works, so you can watch it fetch the PR, compile a
program, and save its draft review.

## The capability is the review surface

Everything the agent can do to a pull request is declared in `sandbox/API.jo`:

```jo
interface GitHub
  def getPR(): PRInfo
  def readFile(path: String, start: Int = 0, ends: Int = -1): String
  def findDefinition(identifier: String): List[DefinitionMatch]
  def saveDraftReview(body: String, comments: List[LineComment]): Unit receives stdout
end
```

A generated program names those operations and nothing else:

```jo
namespace sandbox.guest
import jo.IO.stdout
import sandbox.api.*

def runTask(): Unit receives stdout, github =
  val pr = github.getPR()
  for diff in pr.diffs do
    println "\{diff.status} | \{diff.path} (+\{diff.additions} -\{diff.deletions})"

  github.saveDraftReview("Draft review summary", [])
```

The guest module in `sandbox/jo.toml` depends only on `api` and the pure `caps`
package. It never depends on `harpe`, so the implementations — the HTTP client
in `GithubClient.jo`, the token read from the environment — are not in its
dependency graph at all. A program that tries to open a socket, read an
arbitrary file, or call an operation this interface does not declare fails to
compile, and a failed compile is fed back to the model as an error to fix.

`sandbox/Runtime.jo` is where the two halves meet. It constructs the
implementation with the PR URL and token, binds it to the `github` capability,
and calls the guest:

```jo
with api.github = ghImpl in
  api.runTask()
```

## Draft-only is the boundary

`AGENT.md` instructs the agent to submit reviews as **pending** drafts, and the
capability enforces that policy. `saveDraftReview` has no verdict argument; its
trusted implementation always omits GitHub's event field, which saves a draft.
Publishing, standalone comments, and merging are absent from `interface GitHub`,
so a model-written program that attempts any of them does not compile.

This is a typical example of **REST API surface narrowing**, and a strong point
of Jo's capability model. The trusted runtime can integrate with GitHub's broad
REST API, while the generated program sees a smaller typed interface containing
only the operations appropriate for its role. Authority is reduced structurally,
not by asking the model to avoid dangerous endpoints.

To add a publishing operation, widen the interface and protect the effect inside
the trusted implementation with [human approval](/concepts/approvals/). The
implementation should perform it only after `Approvals.Approved`; adding an
instruction to the prompt alone would not create a boundary.

The [flight booking agent](/tutorial/create-flight-booking-agent/) demonstrates
that approval pattern for placing orders.

## What to customize

```text
my-reviewer/
  AGENT.md               # the review philosophy and workflow the model reads
  src/
    Main.jo              # startup, tool assembly, and one turn
    PrintInteract.jo     # maps turn events to terminal output
  sandbox/
    API.jo               # the GitHub capability a generated program may call
    GithubClient.jo      # the HTTP client behind it
    Runtime.jo           # binds the implementation to the capability
    Task.jo              # the guest entry point runCode overwrites each turn
  skills/
    api.jo               # symlink to sandbox/API.jo; read on demand
    jo-syntax.md         # Jo syntax reference
```

- Edit `AGENT.md` to change what the review flags and how it is worded.
- Edit `sandbox/API.jo` to change what the agent may do at all, then update
  `GithubImpl` in `sandbox/Runtime.jo` to implement it.
- `skills/api.jo` links to `sandbox/API.jo`, so the model reads the exact contract
  with `skillsRead` rather than carrying it in every prompt.
- Edit `src/Main.jo` to change the model, the tool budget, or the environment
  granted to the guest. The PR URL and token reach the sandbox as an ordinary
  argument:

  ```jo
  val guestEnv = Map:
    "PR_URL" ~ pr
    "GITHUB_TOKEN" ~ os.getenv("GITHUB_TOKEN", "")
  ```
