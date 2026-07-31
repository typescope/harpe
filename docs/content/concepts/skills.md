+++
title = "Skills"
+++
Skills are the agent's **reference material** — files it reads on demand while
working. Drop a Markdown file (or any file) into your agent's `skills/` directory,
and the agent can list, search, and read it through three built-in tools. Skills
are how the agent *knows* things. Tools are how it *acts*. It reads its skills
freely, but still acts only through `runCode`.

## Why skills instead of the prompt

Everything in `AGENT.md` is in the model's context on *every* request — so a large
reference there is paid for each turn and crowds out the conversation. Skills invert
that: the reference lives on disk, and the agent pulls in only the pieces a task
needs (progressive disclosure). Keep `AGENT.md` to the agent's role and a pointer to
its skills. Keep the detail — cheat sheets, API docs, examples, house style — in
`skills/`.

Three ways an agent carries knowledge, for contrast:

- **`AGENT.md`** — always-on instructions, in context every turn.
- **skills** — on-demand reference *you* author (this page).
- **[memory](/concepts/memory/)** — volatile state the agent curates itself through the
  memory tools.

## Adding a skill

No code, no registration — a skill is just a file:

```
skills/
  jo-cheat-sheet.md
  api/
    payments.md
```

Any file type works (names carry their extension), and subdirectories are fine —
the agent sees relative names like `api/payments.md`. Markdown is the usual choice.

## The tools

`Defaults.tools()` gives every agent three read-only tools over `skills/`:

- **`skillsList`** — the names of all skill files (with extensions).
- **`skillsRead`** — the contents of one file, by name.
- **`skillsSearch`** — a case-insensitive substring search across every file,
  returning matching lines as `name:line: text`.

A typical flow: the agent `skillsSearch`es for a term, then `skillsRead`s the file
that matched.

## Pointing the agent at them

The tools exist, but the model won't reach for them unless told to. Describe the
skills in `AGENT.md` — what's there and when to consult it:

> Your reference docs are in your skills. Before writing Jo, consult
> `jo-cheat-sheet.md`. For payment flows, read `api/payments.md`.

## Guarantees

- **Read-only.** The tools only read. The agent cannot modify `skills/` through them.
- **Confined.** Reads are locked to the skills directory — a `..` or absolute path
  is denied, so the agent can't reach outside its knowledge folder.
- **Robust.** Reads are best-effort UTF-8: a binary or undecodable file yields empty
  text instead of crashing a search, and results are capped so one query can't flood
  the context.
