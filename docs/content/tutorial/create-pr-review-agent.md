+++
title = "Create a PR Review Agent"
+++
The PR review example is a complete agent that reviews a GitHub pull request and
submits the review. It reads the diff, follows identifiers into the repository
snapshot, and posts a verdict — all by writing Jo programs against a GitHub
capability that offers five operations and nothing else.

## Create the project

```sh
jo new my-reviewer --template typescope/harpe:pr-review
cd my-reviewer
pip install -r requirements.txt
```

Create a `.env` file with a GitHub personal access token carrying the `repo`
scope, plus one model provider key:

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
program, and submit its verdict.

## The capability is the review surface

Everything the agent can do to a pull request is declared in `sandbox/API.jo`:

```jo
interface GitHub
  def getPR(): PRInfo
  def readFile(path: String, start: Int = 0, ends: Int = -1): String
  def findDefinition(identifier: String): List[DefinitionMatch]
  def submitReview(verdict: ReviewVerdict, body: String, comments: List[LineComment]): Unit receives stdout
  def addComment(body: String): Unit receives stdout
  def merge(commitMessage: String): Unit receives stdout
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

## Prompt policy is not the boundary

`AGENT.md` instructs the agent to submit reviews as **pending** drafts so a human
verifies them before they publish. That instruction is a policy the model
follows, not a constraint the compiler enforces — `submitReview` accepts
`Approve` and `RequestChanges`, and `merge` is granted outright.

The distinction matters, and the example is a good place to practice it. To make
the policy structural rather than advisory, change the interface instead of the
prompt:

- Delete `merge` from `interface GitHub`. Programs calling it stop compiling.
- Narrow `submitReview` to accept only `Pending`, so publishing stays a human
  action.
- Or keep the operation and require
  [human approval](/concepts/approvals/) inside `GithubImpl`, which performs the
  effect only after `Approvals.Approved`.

The [flight booking agent](/tutorial/create-flight-booking-agent/) takes the
third route for placing orders.

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
    api.jo               # capability reference the model reads on demand
    jo-syntax.md         # Jo syntax reference
```

- Edit `AGENT.md` to change what the review flags and how it is worded.
- Edit `sandbox/API.jo` to change what the agent may do at all, then update
  `GithubImpl` in `sandbox/Runtime.jo` to implement it.
- Edit `skills/api.jo` so the model's reference matches the interface. The agent
  reads it with `skillsRead` rather than carrying it in every prompt.
- Edit `src/Main.jo` to change the model, the tool budget, or the environment
  granted to the guest. The PR URL and token reach the sandbox as an ordinary
  argument:

  ```jo
  val guestEnv = Map:
    "PR_URL" ~ pr
    "GITHUB_TOKEN" ~ os.getenv("GITHUB_TOKEN", "")
  ```
