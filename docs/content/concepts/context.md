+++
title = "Context management"
+++
A model's input is bounded, but a session can run indefinitely. So on every
request *something* must decide what the model sees — the instructions, how much
of the conversation. That decision is the
**Context**: a per-session strategy you configure or replace.

## What the model sees each request

For each model call, the Context composes a `Rendered` — two parts:

```jo
class Rendered(system: String, messages: List[Message])
```

- **`system`** — the stable instructions: your base prompt, used verbatim (plus a
  distilled summary, if the strategy keeps one).
- **`messages`** — the recent transcript, as much as the strategy's window holds.

## The built-in strategies

All render the base prompt as `system`. They differ in how much semantic history
they retain and how they reduce it.

**`FullContext`.** Keeps the complete semantic history. It is the simplest
choice for the common case where conversations are short enough to fit without
context management. `Context.noHistory`, the default for a plain `Agent.ask`,
uses a fresh `FullContext` for that one call.

**`TurnContext`.** Keeps only the active logical turn. On commit or abort its
working messages are cleared, so past conversation never enters later model
calls implicitly. Applications can pair it with transcript-query tools when the
model should retrieve old turns selectively. It is an explicit policy for
retrieval-oriented agents, not the general default.

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
| `FullContext` | retained verbatim | none | ordinary short conversations |
| `TurnContext` | unavailable unless retrieved through a tool | none | bounded working context with explicit transcript retrieval |
| `WindowedContext` | dropped | none | short sessions, or agents that keep their own notes |
| `SummarizingContext` | a rolling summary | one per compaction | long sessions that must recall early detail |

## Choosing and configuring

The strategy is per-session, constructed where the driver builds its `Agent`:

```jo
// Short conversations: retain the complete semantic history.
new FullContext:
  baseSystem = "You are a helpful assistant."
  initial = history

// Current turn only, for an agent that retrieves older history explicitly.
new TurnContext("You are a helpful assistant.")

// cross-turn history: a sliding window (fixed size, no knobs)
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

Another policy is to keep model context turn-local and let application tools
query durable conversation history. The transcript remains the complete record.
`TurnContext` becomes bounded working memory. The model retrieves only the past
information relevant to its current task. Transcript querying belongs in tools
or an application-owned read API, not in the `Context` interface itself.

## Writing your own strategy

A `Context` has an explicit turn lifecycle:

```jo
interface Context
  def beginTurn(input: UserInput): Unit               // open a turn and add its input
  def append(message: Message): Unit                  // record a transcript event
  def compact(interact: Interact): Context.Result    // current snapshot + whether it compacted
  def observe(usage: Usage): Unit                     // the last reply's token counts
  def commitTurn(): Unit                              // finish a successful turn
  def abortTurn(): Unit                               // discard its provisional model/tool tail
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
- **`beginTurn` / `commitTurn` / `abortTurn`** make retention policy explicit.
  The built-in cross-turn contexts retain a successful turn. On abort they
  restore the pre-turn state while retaining the user's request, matching the
  durable transcript. `TurnContext` clears all working messages in either case.

`FullContext`, `TurnContext`, `WindowedContext`, and `SummarizingContext` are
four points in this space. A
different need — semantic retrieval, a hard token cap, per-tool pruning — is a new
`Context` you use when constructing the agent. Their sources (`agent/context/`)
are the reference to copy from.
