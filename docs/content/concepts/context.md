+++
title = "Context"
+++
A model can see only the input payload from an HTTP request. Context determines
which instructions and conversation messages Harpe sends on each request.

During a turn, Harpe adds the user's message, model replies, tool calls, and tool
results to the context. If the model calls several tools before answering, each
new request sees the relevant work from earlier in that turn.

Across turns, the context strategy determines what's carried over in requests to the model.

## Context belongs to a session

Create one context for a conversation and pass the same object to every
`Agent.ask` call in that session:

```jo
val context = new WindowedContext:
  baseSystem = File.read(os.path.join(appHome, "prompts/SYSTEM.md"))
  initial = []

val first = Agent.ask:
  "My project is called Atlas"
  brain = brain
  context = context

val second = Agent.ask:
  "What is my project called?"
  brain = brain
  context = context
```

The second turn can see the first because both use the same context.

If `context` is omitted, `Agent.ask` creates a fresh no-history context for that
call. The model still sees the complete active turn, including tool results, but
nothing is carried into a later `Agent.ask` call.

## Context is not the transcript

Context and transcript receive the same conversation events, but they serve
different purposes:

| | Context | Transcript |
| --- | --- | --- |
| Purpose | Prepare the model's next input | Read back what happened |
| Retention | May omit or summarize older turns | Append-only history |
| Lifetime | Usually held in memory for a session | As durable as the log it is read from |
| Used by the model | Yes | Only when the application exposes or replays it |

Removing an old turn from model context does not need to delete it from the
transcript. A journal can preserve the complete conversation while the model
works with only a recent window.

Context itself does not persist a session. When reopening a session, the
application loads the relevant messages from its journal or other store and uses
them as the new context's `initial` history.

## What the model receives

At each model-call boundary, a context produces:

```jo
class Rendered(system: String, messages: List[Message])
```

- `system` contains the base instructions, usually loaded from `prompts/SYSTEM.md`. A
  summarizing strategy may add its rolling summary here.
- `messages` contains the conversation history selected by the strategy,
  including the active turn.

The model provider receives this snapshot. It does not read the context object,
session journal, or application files directly.

## Built-in strategies

Harpe provides four retention strategies:

| Strategy | What later turns can see | Extra model calls | Suitable for |
| --- | --- | --- | --- |
| `FullContext` | Every retained turn verbatim | None | Short conversations known to fit the model window |
| `WindowedContext` | A recent character-bounded window | None | General sessions where recent context is sufficient |
| `SummarizingContext` | Recent turns plus a summary of older turns | One call when compacting | Long conversations that must retain their thread |
| `TurnContext` | Only the active turn | None | Agents that retrieve prior history explicitly through tools |

### Full context

`FullContext` sends every retained message on every request. It is predictable
and preserves all detail, but it does not enforce a size limit. A long session
can eventually exceed the model's context window.

Use it for short conversations, one-off tasks, and applications that enforce
their own limits.

### Windowed context

`WindowedContext` sends only the most recent whole turns that fit its fixed
character budget. It requires no additional model call and bounds accumulated
cross-turn history. It always keeps the newest turn intact, even when that turn
alone exceeds the target. Once an older turn falls outside the window, the model
cannot use it unless the application exposes that information through another
mechanism.

Harpe's shipped conversational applications use this strategy, but
`Agent.ask` does not select it automatically. The application must construct and
reuse it.

### Summarizing context

`SummarizingContext` keeps recent turns verbatim and distills older turns into a
rolling summary. The summary helps preserve goals, decisions, and important
facts without sending the complete conversation.

Summaries trade exact detail for continuity. They also require an additional
model call when compaction occurs. The application supplies the distillation
function, so it can use the agent's model, a cheaper model, or another
summarization implementation.

Compaction is reactive. Harpe learns the exact input-token count from the
provider after a reply. If that count crosses the configured high-water mark,
the context compacts before a later model request. One oversized request can
therefore occur before compaction.

### Turn context

`TurnContext` retains the user's message and all model and tool activity within
the active turn. It clears that working history when the turn ends.

Use it when prior conversation should be retrieved deliberately through an
application tool instead of being included automatically. The transcript can
remain complete even though the model context is turn-local.

## Choosing a strategy

Start from the information the next turn needs:

- Use `FullContext` when sessions are predictably short.
- Use `WindowedContext` when recent conversation is enough and simplicity
  matters.
- Use `SummarizingContext` when long-running conversations need continuity.
- Use `TurnContext` when the agent has an explicit history-retrieval mechanism
  or should treat every turn independently.

Construct the chosen context once per session:

```jo
val full = new FullContext:
  baseSystem = basePrompt
  initial = history

val windowed = new WindowedContext:
  baseSystem = basePrompt
  initial = history

val turnLocal = new TurnContext(basePrompt)

val summarized = new SummarizingContext:
  baseSystem = basePrompt
  initial = history
  highWaterTokens = 120000
  lowWaterChars = 160000
  distill = rendered => summarize(rendered)
```

`history` is a `List[Message]`. Use `[]` for a new session or replay messages
from the session transcript when resuming one.

For `SummarizingContext`, the high-water mark decides when to compact using the
provider's reported input-token count. The low-water target decides how much
recent history to keep using characters. Leave enough space below the model's
context limit for tool results and the next reply.

## Durable memory

Context is working conversation memory, not a general knowledge store. Anything
outside the retained window is unavailable to the model unless it is summarized
or retrieved again.

An application that needs durable facts can provide a tool for notes, records,
or transcript search. The agent can then retrieve only the information relevant
to the current task. Harpe does not require a particular storage format or grant
filesystem access automatically.

## Custom strategies

Implement `Context` when the built-in retention policies do not match the
application. A custom strategy might retrieve semantically related turns,
enforce a hard budget, add application-owned notes, or prune particular tool
results.

Every context follows the same turn lifecycle. It receives the user input and
subsequent messages, prepares a `Rendered` snapshot at model-call boundaries,
observes provider usage, and either commits or aborts the turn. The built-in
implementations in `agent/context/` are practical references for custom
strategies.
