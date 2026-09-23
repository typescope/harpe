+++
title = "GitHub PR Review"
aliases = ["/tutorial/create-pr-review-agent/"]
+++

**A GitHub pull request reviewer.** It reads the diff, follows identifiers into
a snapshot of the repository, and leaves a **pending draft review** for a person
to look at. It cannot publish a standalone comment, approve, or merge.

## The problem

To review a pull request, a review agent has to read contents from a repository and post useful comments to the pull request. The credential authorizes the
actions is usually a github API token which can be scoped to one repository.

If we want to restrict the agent to only post draft review comments without other write actions like merging pull requests, then it cannot be supported by token authorization which is either read only or both read and write.

![What the review needs, against what a credential grants. The reviewer needs
four operations: read the pull request, read repository files, search code, and
create a pending review. The smallest credential that supplies those also grants
submitting a review, approving, requesting changes, dismissing a review and
closing the pull request.](/img/pr-review-surface.svg)

## Harpe's Approach
Under harpe's framework, actions the review agent can do is predefined and declared in an interface file `sandbox/API.jo`:

```jo
interface GitHub
  def getPR(): PRInfo
  def readFile(path: String, start: Int = 0, ends: Int = -1): String
  def findDefinition(identifier: String): List[DefinitionMatch]
  def saveDraftReview(body: String, comments: List[LineComment]): Unit receives stdout
end
```

A generated program can only use those operations:

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

This also solves the exfiltration problem: no operation to
sends bytes to a destination other than the program chooses. The one channel out is the review body.

### Run it

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
prints each tool call as it works, so you can watch it fetching the PR, compiling a program, and saving its draft review.

### Interface Extension

`prompts/SYSTEM.md` instructs the agent to submit reviews as **pending** drafts, and the
capability interface enforces that policy.

To add other capabilities like the publishing operation, widen the interface and protect side effect with the trusted [human approval](/concepts/approvals/) if needed.
