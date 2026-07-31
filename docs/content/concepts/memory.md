+++
title = "Memory"
+++
Memory is the agent's **working scratchpad** — a small key→value store the model
maintains itself, shown back to it every turn and saved across sessions. It is the
*durable* half of the loop's state. The transcript is the *ephemeral* half. When
the [Context](/concepts/context/) windows or summarizes old turns away, whatever the agent
wrote to memory stays.

## Why it exists

A model's context is bounded, so the conversation is trimmed as it grows — early
detail gets dropped or distilled. That's fine for chatter, but an agent needs to
carry some things forward reliably: its goal, a plan, facts it discovered, a todo
list. Memory is that reliable place, independent of the transcript window.

## How the agent uses it

Three tools are wired into the shipped drivers with `memoryTools(memory)`:

- **`updateMemory(key, value)`** — set or replace the *whole* value under a key.
- **`readMemory(key)`** — read one key's current value.
- **`listMemory()`** — list the keys in use.

There is no schema — keys are whatever the agent finds useful (`goal`, `plan`,
`todos`, …), and values are plain text. Updates are whole-value replacements, not
appends: to revise, the agent reads the value, then writes the full new one.

## Your part: steer it

You don't write memory in code — the model does. Your job is to tell it *what to
keep*, in `AGENT.md`:

> Maintain your working context in memory. Keep a `goal` and a `plan` of remaining
> steps, and update them as you make progress. Record durable `facts` you learn.

Everything in memory is rendered back to the agent each turn — a **Working memory**
block placed after the transcript — so it always sees, and can revise, its own
notes.

## Persistence

Memory is per session and survives restarts. After each committed turn the driver
writes a snapshot to `<session>.memory.json` (the current state, not an event log,
written atomically). Resuming that session loads it back. An interrupted or failed
turn does **not** roll memory back — an `updateMemory` is an intentional act,
independent of how the turn ends.

## Memory, skills, and AGENT.md

All three feed the model, but they differ in who writes them and when they're seen:

| | written by | in context | changes |
|---|---|---|---|
| **`AGENT.md`** | you | every turn | static |
| **[skills](/concepts/skills/)** | you | on demand (the agent reads) | static |
| **memory** | the agent | every turn | per session, live |

Memory is the only one the *agent* authors — its own evolving notes, which is why
it's the place for state that changes as the session runs.
