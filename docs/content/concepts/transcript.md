+++
title = "Transcript"
+++
A **transcript** is the record of a conversation: what the user asked, what the
agent said back, and everything the turn did in between. It is what a page
renders when someone reloads it, and what a session resumes from.

It is not the same thing as the [log](/concepts/logging/), though with the
shipped implementation the two end up in the same file. The log holds
*everything that happened* — every `runCode` execution, every model retry, every
diagnostic a tool chose to emit. The transcript holds *the conversation the user
had*. One is for auditing, the other is for people, and the difference is not a
filter you apply afterwards: it is recorded as the turn runs.

## Two writers

The engine writes the turn's own traffic. `Agent.ask` opens with the input it is
about to run, records each assistant reply and each batch of tool results, and
closes with exactly one terminator:

```jo
interface Transcript
  def start(input: UserInput): Unit
  def append(message: Assistant | ToolResults): Unit

  def commit(): Unit
  def interrupted(): Unit
  def failed(detail: String): Unit
end
```

That is the whole interface, because it is exactly what the engine calls. The
framework ships `Journal`, which appends each record through a `Logger`:

```jo
val transcript = new Journal(sessionLog)
Agent.ask(prompt, brain = brain, tools = tools, context = context, transcript = transcript)
```

An application that keeps its conversations in a database implements the
interface instead, and the engine cannot tell the difference. Unbound,
`transcript` defaults to `Transcript.NoTranscript`, so a turn that records
nothing still runs.

## The bracket: what makes a turn a conversation

The engine's records alone are not a transcript. A subagent, a background job, or
a one-shot script all drive `Agent.ask`, and all of them write the same
`harpe.turn.*` records. What marks a turn as the *user's* is that a driver
bracketed it: a **turn input** written before, and a **turn output** written
after.

### The general shape

The bracket is where the application's own vocabulary lives. A turn input is what
the user actually did — an upload with three files, a slash command, a form
submission — before the engine desugared it into a prompt. A turn output is the
driver's reading of what came of it — the files delivered, the message sent, the
rejection shown.

Neither is on the `Transcript` interface, and that is the point. `Agent.ask`
never writes a bracket; only a driver does. Leaving it out keeps the interface
free of any payload type, so an application's transcript brackets its **own
types**:

```jo
//[ This application's turn input and turn output. //]
class Uploaded(text: String, files: List[Named])
class Delivered(sent: List[Named], truncated: Bool)

class Conversation(db: Db, id: Int)
  view Transcript

  //[ Its bracket, over its own types — no `Value` in sight. //]
  def turn(asked: Uploaded, work: () => Delivered): Unit =
    val row = db.open(id, asked)
    db.close(row, work())

  // …the five engine methods…
end
```

A transcript backed by a table can store `Uploaded` in columns and read it back
typed. Nothing in the framework has to know the shape, because nothing in the
framework ever looks at it.

### How `Journal` carries them

`Journal` writes through a `Logger`, and a log `Entry` holds `Value` — a JSON
tree. So the shipped bracket is untyped at the boundary, and the driver encodes
and parses its own types across it:

```jo
def turn(data: Value, work: () => Value): Unit
def request(data: Value): Unit
def response(data: Value): Unit
```

`turn` writes the opening record, runs the work, and writes the closing record
from what the work returns — so the two cannot drift apart:

```jo
transcript.turn: Journal.payload("text" ~ text, "files" ~ names(attachments)), () =>
  // …run the turn…
  Journal.payload("sent" ~ delivered(turn))
```

`Journal.payload` builds the `Value`; without it the map needs an explicit
`Map[String, Value](...)`, since a bare map of strings infers `Map[String,
String]`. A payload that is not a map — a bare marker string, a list — passes
straight through.

Where the two halves cannot share a call — one thread queues the request,
another runs it — the driver writes `request` and `response` directly. Those are
the same two records; `turn` is only the form that cannot be half-written.

### What to put in each

**The opening payload** is what the user sent. The web driver records the raw
text and the upload metadata, which is why its page shows what was typed rather
than the file manifest the model saw.

**The closing payload** is thin on purpose. The replies and tool traffic are
already recorded and come back as `TurnRecord.data`, so copying them here only
creates a second version to keep in sync. Record what the engine cannot know:
the files the agent delivered, whether the reply actually reached the chat. When
there is nothing, a bare marker is honest — the CLI writes `"turnEnd"`.

Open the bracket **early**, at the top of the handler, before whatever queue or
lock the request waits behind. The gap between it and the `start` that follows is
then exactly how long the request was queued.

## Reading it back

`Journal.records` folds decoded entries into complete turns:

```jo
class TurnRecord(request: Value, response: Value, data: TurnData)
```

`request` and `response` are the bracket. `data` is the engine's own account —
the user message, the assistant replies, the tool results, and how the turn
ended.

A record is complete by construction. A bracket missing either half — what a
process killed mid-turn leaves behind — yields no record at all. The fragment
stays in the log for anyone auditing it, and the type carries no holes for every
consumer to check.

There is no id. A journal holds one conversation whose turns are recorded in
order, so an opening record pairs with the next closing one. A driver that wants
a stable handle for retry, a permalink, or a delete puts its own inside the
request payload, alongside everything else it knows.

## Resuming from it

The model's history comes from the same place the page does:

```jo
Journal.fromEntries(entries)   // List[Message], ready to seed a Context
```

Because both derive from `records`, what the model remembers and what the user
sees cannot disagree. This is also why the gate matters: without it, a subagent
running against a session's log would splice its own conversation into the
parent's history — a far worse failure than a missing scrollback.

User messages survive every outcome, since a driver closes the bracket on
failures too. Only answered turns contribute their assistant and tool messages.

## Transcript and Context are separate

Both see every message of a turn, and they are deliberately not merged:

|            | Transcript                        | [Context](/concepts/context/)                    |
|------------|-----------------------------------|--------------------------------------------------|
| holds      | what was said                     | what the model is shown, plus the system prompt   |
| on failure | appends a terminator              | rolls back the provisional tail                   |
| lifetime   | durable                           | per session, in memory                            |

A `Context` is not a view of the transcript. It composes the whole request: the
base system prompt, and whatever slice of the conversation its strategy keeps.
`WindowedContext` drops the oldest turns past a character budget;
`SummarizingContext` distills them into a rolling summary carried in `system`
instead; an application writes its own for anything else. The system prompt has
nothing to do with what was said, which is why one type cannot honestly be the
other.

## Writing your own

Implement the five methods. That is the entire obligation — the bracket and the
reading side are yours, as sketched above, so nothing forces a `Value` on you and
nothing forces a whole-file fold to answer a history query.

```jo
class Conversation(db: Db, id: Int)
  view Transcript

  def start(input: UserInput): Unit = db.append(id, "user", input.text)
  def append(message: Assistant | ToolResults): Unit = …
  def commit(): Unit = db.finish(id, "answered")
  def interrupted(): Unit = db.finish(id, "interrupted")
  def failed(detail: String): Unit = db.finish(id, "failed", detail)
end
```

A transcript records. It never rolls back: a failed turn appends a terminator
rather than erasing what came before, which is why the engine's rollback goes to
the `Context` and never here.

## See also

- [Observability](/concepts/observability/) — watching a journal live in a browser
- [Logging](/concepts/logging/) — the structured event stream underneath
- [Context](/concepts/context/) — what the model is shown each request
