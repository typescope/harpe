+++
title = "Context management"
+++
A model's input is bounded, but a session can run indefinitely. So on every
request *something* must decide what the model sees — the instructions, how much
of the conversation. That decision is the
**Context**: a per-session strategy you configure or replace. Implementing it is
the whole customization surface for context engineering. There is no second hook.

## What the model sees each request

For each model call, the Context composes a `Rendered` — two parts:

```jo
class Rendered(system: String, messages: List[Message])
```

- **`system`** — the stable instructions: your base prompt, used verbatim (plus a
  distilled summary, if the strategy keeps one).
- **`messages`** — the recent transcript, as much as the strategy's window holds.

There is no third slot for volatile content. A strategy that wants working notes
or retrieved documents in front of the model appends them to `messages` as a
trailing user message — past the cached prefix, so changing them costs nothing.

## The two built-in strategies

Both render the base prompt as `system`. They differ only in what they do when
the transcript outgrows the window.

**`WindowedContext` (the default).** A sliding window: once the transcript passes
a fixed character budget, the oldest whole turns are dropped from what's sent (the
driver's on-disk session archive still keeps them). Cheap and simple — no extra
model calls — but dropped detail is gone unless the agent wrote it down.

**`SummarizingContext`.** Instead of dropping old turns, it distills them into a
rolling summary — one extra call to a "distiller" model — carried in `system`. A
long session keeps its thread at the cost of an occasional summarization call.
Compaction triggers when the provider's reported input-token count crosses a
high-water mark, then folds the oldest turns until the window fits a low-water
target.

| | old turns become | extra model calls | best for |
|---|---|---|---|
| `WindowedContext` | dropped | none | short sessions, or agents that keep their own notes |
| `SummarizingContext` | a rolling summary | one per compaction | long sessions that must recall early detail |

## Choosing and configuring

The strategy is per-session, constructed where the driver builds its `Agent`:

```jo
// default: a sliding window (fixed size, no knobs)
new WindowedContext:
  baseSystem = "You are a helpful assistant."
  initial = history

// or: summarize instead of dropping
new SummarizingContext:
  baseSystem = "You are a helpful assistant."
  initial = history
  highWaterTokens = 120000
  lowWaterChars = 160000
  distill = distiller
```

- `baseSystem` is the system prompt — a string, however you produce it. The
  shipped applications read theirs from `AGENT.md`. `history` seeds the window
  (a resumed session's transcript, or `[]` for a fresh one).
- `distiller` is any `Model` — the agent's brain, or a cheaper model reserved for
  summaries.
- `highWaterTokens` is the budget you compact at. It's a **policy, not the model's
  limit**: set it *below* the context window, leaving room for the reply and
  holding down cost/latency. It's measured against the provider's exact reported
  count, so it's model-accurate.
- `lowWaterChars` is how much recent transcript to keep (in characters — the
  truncation unit. About four characters per token is why this figure isn't directly
  comparable to the token high-water). Keep it well below the high-water mark so
  compactions stay rare and the cached prefix survives.

One behavior to know: `SummarizingContext` is **reactive** — it learns the token
count only *after* a reply, so a single oversized request can go out before the
next one compacts.

## Carrying facts past the window

Nothing the agent knows survives the window except what it writes down. The
framework offers no store for that, deliberately: the agent already has a
filesystem through `fs`, so a notes file it maintains itself is one mechanism
instead of two, and its format is the agent's own rather than a schema the
framework imposed.

A driver that wants those notes in front of the model on every request writes a
`Context` that reads the file and appends it to `messages` — see below.

## Writing your own strategy

A `Context` is five methods:

```jo
interface Context
  def append(message: Message): Unit                  // record a transcript event
  def compact(interact: Interact): Context.Result    // current snapshot + whether it compacted
  def observe(usage: Usage): Unit                     // the last reply's token counts
  def mark(): Unit                                    // begin a turn (rollback point)
  def rollback(): Unit                                // undo an interrupted/failed turn
end
```

- **`compact`** is where your policy lives. It runs at model-call boundaries and may be
  effectful: call the model first through `interact` (e.g. to summarize) and
  mutate your own state. It returns both the prepared `Rendered` snapshot and a
  flag telling the engine whether the current provider session must be replaced.
  (It carries `receives logger` because a model call it makes logs token usage.)
- **`observe`** hands you the provider's exact token count after each reply, so you
  can size on real usage instead of estimating — how `SummarizingContext` decides
  to compact.
- **`mark` / `rollback`** bracket a turn: if a turn is cancelled or fails, the
  engine rolls your state back, so a half-finished turn leaves no trace. Restore
  everything a turn may have changed (transcript, any summary, counters).

`WindowedContext` and `SummarizingContext` are two points in this space. A
different need — semantic retrieval, a hard token cap, per-tool pruning — is a new
`Context` you use when constructing the agent. Their sources (`agent/context/`)
are the reference to copy from.
