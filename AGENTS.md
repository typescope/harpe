# Harpe contributor instructions

Harpe is a Jo framework and template repository.

## Important distinction

- `AGENTS.md` contains instructions for coding agents modifying this repository.
- `templates/*/prompts/SYSTEM.md` is loaded by a running example agent.
- Do not put a runtime agent persona or tool instructions in this file.

## Repository layout

- `agent/` — framework implementation
- `cli/` — interactive CLI application
- `templates/` — user-facing example agents
- `tests/` — framework tests
- `docs/` — Zola documentation
- `.github/workflows/` — CI and documentation workflows

## Development commands

- Run framework tests with `jo run test` from the repository root.
- Build a template with `jo build agent` from its directory.
- Run template end-to-end tests with `jo run tests` from the template directory.
- Build the documentation with `zola build` from `docs/`.

Run the smallest affected check first, then broaden validation when the change warrants it.

## Conventions

- Search with `rg` or `rg --files`.
- Use `apply_patch` for source edits.
- Follow existing Jo syntax, naming, and indentation.
- Keep runtime prompts in `templates/*/prompts/SYSTEM.md`.
- Do not edit generated `.build/` output.
- Preserve unrelated worktree changes.

## Release boundaries

Template manifests intentionally use published Harpe versions. Do not retarget them to local framework sources unless the task explicitly concerns release compatibility.

## Completion

Before handing off a change, inspect the diff, run the relevant checks, and report any checks that could not run.
