+++
title = "Transcript"
+++
A transcript records the user-facing turns in a conversation. It can provide
chat history for the user interface and seed model context when a session is
resumed.

Recording is optional. If `transcript` is omitted from `Agent.ask`, Harpe uses
`Transcript.NoTranscript` and the turn is not persisted by the framework.

## Transcript, context, and logs

These concepts see related events but serve different purposes:

| Concept | Purpose | Typical lifetime |
| --- | --- | --- |
| [Context](/concepts/context/) | Select the instructions and history sent to the model | One active session |
| Transcript | Record user-facing conversation turns | Across session restarts when persisted |
| [Log](/concepts/logging/) | Record operational events for diagnostics and auditing | Application-defined |

A context may omit or summarize old turns without deleting them from the
transcript. A log may contain model retries, tool diagnostics, and code execution
details that are not part of the conversation shown to the user.

## Recording a turn

Harpe provides `Journal`, a transcript implementation that writes structured
entries through a `Logger`. A common file-backed setup is:

```jo
val sessionLog = new JsonlLogger(sessionPath)
val transcript = new Journal(sessionLog)
```

Pass the journal to every turn in that session:

```jo
val turn =
  Agent.ask:
    message
    brain = brain
    tools = tools
    context = context
    transcript = transcript
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
transcript.request:
  Journal.payload("text" ~ message, "files" ~ uploadedFiles)

val turn =
  Agent.ask:
    message
    brain = brain
    tools = tools
    context = context
    transcript = transcript

transcript.response:
  Journal.payload("reply" ~ replyForUser(turn))
```

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

## Transcript storage

The core interface contains only the methods `Agent.ask` needs while recording a
turn:

```jo
interface Transcript
  def start(input: UserInput): Unit
  def append(message: Assistant | ToolResults): Unit
  def commit(): Unit
  def interrupted(): Unit
  def failed(detail: String): Unit
end
```

`Journal` implements this interface using structured log entries. An application
can implement it with a database, event stream, or another store. Reading,
querying, and defining the user-facing turn boundary then belong to that
implementation and its driver.

A transcript implementation records events as they occur. It does not roll them
back. On failure, the engine appends a failure terminator while the context rolls
back provisional model and tool history. This difference lets the transcript
preserve what happened while preventing an unsuccessful tail from becoming the
model's future working context.

## See also

- [Context](/concepts/context/) explains what the model sees on each request.
- [Logging](/concepts/logging/) explains the structured operational event stream.
- [Observability](/concepts/observability/) shows how to inspect a journal live.
