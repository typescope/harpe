+++
title = "Transcript"
+++
A transcript records the user-facing turns in a conversation. It can provide
chat history for the user interface and seed model context when a session is
resumed.

Recording is not optional. `Agent.ask` writes the turn to the ambient
[logger](/concepts/logging/) as it runs, so a turn is in the log whether or not
anything reads it back. A transcript is a **projection over those records**, not a
second place to write them.

## Transcript, context, and logs

These concepts see related events but serve different purposes:

| Concept | Purpose | Typical lifetime |
| --- | --- | --- |
| [Context](/concepts/context/) | Select the instructions and history sent to the model | One active session |
| Transcript | A reading of the log as user-facing conversation turns | As long as the log is kept |
| [Log](/concepts/logging/) | Record operational events for diagnostics and auditing | Application-defined |

A context may omit or summarize old turns without deleting them from the
transcript. A log may contain model retries, tool diagnostics, and code execution
details that are not part of the conversation shown to the user.

## Recording a turn

Install a `Logger` for the session and the turn records itself:

```jo
val sessionLog = new JsonlLogger(sessionPath)

with logger = sessionLog in
  Agent.ask:
    message
    brain = brain
    tools = tools
    context = context
```

During the call, `Agent.ask` records:

1. the user input
2. each assistant message and batch of tool results
3. whether the turn answered, was interrupted, or failed

This is the model-facing account of the turn. It does not include every progress
event or diagnostic written to the application log.

## The user-facing turn boundary

The engine knows the prompt it received, but the driver knows what happened in
the user interface. A web request might include uploaded files. A Telegram turn
might deliver a document. The driver records those application-level facts by
placing a request and response around `Agent.ask`:

```jo
val journal = new Journal(sessionLog)

journal.request:
  Journal.payload("text" ~ message, "files" ~ uploadedFiles)

val turn =
  with logger = sessionLog in
    Agent.ask:
      message
      brain = brain
      tools = tools
      context = context

journal.response:
  Journal.payload("reply" ~ replyForUser(turn))
```

`Journal` writes only the bracket. The turn inside it is the engine's, and lands
in the same log either way.

Together, the records have this shape:

```text
driver request
  engine turn start
  assistant and tool messages
  engine turn result
driver response
```

The driver request and response are called the **turn boundary**. They identify
which engine turn belongs to the user's conversation and carry information only
the application knows.

Keep the response payload small. Assistant messages and tool results are already
recorded by the engine. Use the response for facts such as which files reached
the user or how the application presented the result.

`Journal.records` returns only turns enclosed by this boundary. Engine activity
outside a driver request and response remains available in the log but does not
appear as a user-facing conversation turn. This prevents background work from
being mistaken for part of the chat history.

## Reading a conversation

`Journal.records` converts persisted entries into complete user-facing turns:

```jo
class TurnRecord(request: Value, response: Value, data: TurnData)
```

- `request` is the application payload written before the turn.
- `response` is the application payload written after the turn.
- `data` contains the user input, engine messages, and turn result.

The application chooses the shape of the request and response payloads. They are
`Value` because a JSONL journal must serialize them. A database-backed transcript
can store equivalent information in typed columns instead.

An opening request without a matching response is an incomplete fragment and is
not returned by `Journal.records`. Its entries remain in the underlying log for
diagnostics.

## Resuming a session

Read the journal entries and derive model history when reopening a session:

```jo
val history = Journal.load(sessionPath)

val context = new WindowedContext:
  baseSystem = basePrompt
  initial = history
```

`Journal.load` expects the file to exist. Whether a missing file starts a new
conversation or produces an error is application policy.

The user interface can derive its history from `Journal.records` over the same
entries, while the context is seeded from `Journal.load`. Both views therefore
come from the same recorded conversation.

Replay follows the outcome of each completed turn:

- Every user input remains in history.
- Assistant and tool messages are included only for successful turns.
- Failed and interrupted turns do not replay a provisional assistant or tool
  tail.
- The oldest whole turns are dropped if resumed history exceeds the journal's
  replay limit.

The transcript does not recreate the context strategy itself. The application
chooses a new `FullContext`, `WindowedContext`, `SummarizingContext`, or
`TurnContext` when it opens the session.

## Where a conversation is stored

`harpe.turns.TurnLog` owns the record format — the four event names and the one
codec that both writes and reads them:

```jo
harpe.turn.message       every message: the input, an assistant reply, or a
                         batch of tool results — `role` tells them apart
harpe.turn.answered      ┐
harpe.turn.interrupted    ├ one of exactly three terminators
harpe.turn.failed        ┘
```

Storage is a `Logger` backend, which was always the pluggable part. An
application that keeps conversations in a database, or on an event stream,
implements `Logger` — and gets the operational records in the same place, rather
than wiring a second interface and discovering later that only one of them was
connected.

The engine records events as they occur and does not roll them back. On failure
it appends a failure terminator while the *context* rolls back provisional model
and tool history. That difference is what preserves what happened while keeping
an unsuccessful tail out of the model's future working context.

## See also

- [Context](/concepts/context/) explains what the model sees on each request.
- [Logging](/concepts/logging/) explains the structured operational event stream.
- [Observability](/concepts/observability/) shows how to inspect a journal live.
