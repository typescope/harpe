# Contributing to Harpe

Harpe is an early-stage agent framework for [Jo](https://jo-lang.org/), in
developer preview. Contributions are welcome, but the capability model, the turn
engine, and the published package APIs are still stabilizing.

## Building from Source

**Prerequisites:** [Jo](https://jo-lang.org/) 0.13 or newer, and Python 3.10 or
newer.

```sh
curl -sSf https://jo-lang.org/install.sh | sh

python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
jo run test
```

`jo` runs the `python3` first on your `PATH`, so an activated virtual
environment is where the media tests find `pypdfium2`, `python-docx`,
`openpyxl`, and `pillow`.

The suite has three layers, and a path filter selects one of them:

```sh
jo run test -- unit          # the components this repo owns
jo run test -- integration   # provider wire contracts, and the real toolchain
jo run test -- e2e           # the shipped agents, built and run as their own processes
jo run test -- e2e/cli       # just one of them
```

The `e2e` suite lives beside the agent it drives, in `cli/tests/`, and runs from
there. It builds the agent through its own `jo.toml` — against this branch's
sources — starts it as its own process, and types at it through a
pseudo-terminal against a scripted model, with no network and no API key.
Programs the agent writes are compiled by the real toolchain and run in the real
sandbox. A scenario that fails leaves its temporary agent home in place and
quotes what the agent had printed, both named in the failure.

```sh
cd cli && jo test
```

Nothing in this repository resolves the package registry: the framework, the CLI
agent, and both suites all build from these sources, so every check is answerable
by the pull request that breaks it. The other five agents live in
[typescope/agents](https://github.com/typescope/agents), pinned to a published
release — which is what lets an API change land here without being made in six
places at once.

The documentation site is [Zola](https://www.getzola.org/):

```sh
cd docs && zola serve      # `zola build` also checks internal links
```

## Repository Layout

| Path | What it holds |
|---|---|
| `caps/` | Capability interfaces, published as `harpe-caps`. Pure Jo, no FFI |
| `agent/` | The framework, published as `harpe` — turn engine, models, tools, context, logging |
| `testing/` | The test framework, published as `harpe-testing`. Depends on nothing, not even `harpe` |
| `cli/` | The CLI agent and its own end-to-end suite — the framework's only one |
| `tests/` | The `jo run test` suite: unit and integration |
| `docs/` | The documentation site |
| `compose/`, `pycompose/` | An experimental drawing engine, outside the shippable surface |

## What to Contribute

Good first contributions:

- Documentation fixes
- Examples and demos
- Tests
- Bug reports with small reproductions
- Capability implementations
- Small tooling, packaging, or CI fixes

Large pull requests may be declined or delayed if they do not match the current
design direction.

## Style

Match the surrounding code. Four conventions are worth stating:

- Pass a bare literal as a named argument at the call site — `success = false`,
  not `false`.
- Prefer the colon call syntax for nested and multiline calls. Arguments follow
  the colon on the same line, or as an indented block with one per line. It keeps
  a nested call from ending in a run of closing parentheses, and it lets a long
  argument list break without hanging indentation:

  ```jo
  interact.emit: TurnEvent.ToolCallStarted(toolName)

  new ToolOutcome:
    "The tool '\{name}' failed: \{e.message}"
    "error · \{name}"
    attachments = []
    success = false
  ```

  A short, flat call keeps its parentheses.
- Make a definition `private` unless it is meant as framework API. What is not
  private is published in `harpe` or `harpe-caps`, and removing it later is a
  breaking change.
- Put fragmented definitions inside the `section` that owns them rather than at
  the package root, so the namespace stays uncluttered.

## Contribution Terms

By contributing to this project, you agree that your contributions are licensed
under the same license as the project: the MIT License.

This project uses the Developer Certificate of Origin (DCO). Every commit must
include a `Signed-off-by` line certifying that you have the right to submit the
contribution under the project license.

To sign off a commit, use:

```sh
git commit -s
```

The sign-off line should look like this:

```text
Signed-off-by: Your Name <you@example.com>
```

To add a sign-off to the last commit retroactively:

```sh
git commit --amend -s --no-edit
```

To add sign-off to the last three commits:

```sh
git rebase --signoff HEAD~3
```

See the DCO text at <https://developercertificate.org/>.

## Pull Requests

- Keep pull requests focused.
- Include tests for behavior changes when practical.
- Update `docs/` when user-visible behavior changes, and `CHANGELOG.md` when a
  published API changes.
- Do not mix formatting-only changes with behavior changes.
- Do not add new dependencies without prior discussion.
- All pull requests require review before merging.

## Security

Do not report security vulnerabilities in public issues. See
[`SECURITY.md`](SECURITY.md) for the reporting process and for what falls inside
the capability boundary.
