+++
title = "Logging"
+++
Harpe ships a general and flexible **logging framework**. Harpe uses the
framework to log every model call and every `runCode` execution. The framework is
also intended to be used by user programs to collect and store all events of an
application in a unified way.

## Three properties

The logging mechanism is built around three properties:

- **Structural.** Every event is a structured record — an `event` name and named
  fields, not a formatted string. Fields may contain scalars, arrays, or nested
  records. You *query and aggregate* it (per session, per event, summing tokens)
  rather than grepping text.

- **Extensible.** A new kind of event is a new name you emit. A new
  destination is a `Logger` you install. The two are independent and the wiring
  never grows — one channel carries everything, from `runCode` to your own tools.

- **Contextual.** Applications using a shared destination can stamp events with
  ambient context such as the session or chat that produced them. Applications
  storing one file per session already carry that identity in the file path.

## The structure of a log entry

Every logged event becomes an `Entry`:

```jo
class Entry(time: Float, event: String, fields: Map[String, Value], context: List[String])

type Value =
  (String | Float | Value.IntVal | Value.BoolVal | List[Value] | Map[String, Value])
    :- [Value.IntVal, Value.BoolVal]

section Value
  class IntVal(value: Int)
  class BoolVal(value: Bool)
end
```

- `time` records when the event occurred as epoch seconds. A JSONL logger writes
  it as an RFC 3339 UTC timestamp.
- `event` is a stable dotted name for what happened, such as
  `harpe.model.replied` or `myagent.tools.weather.called`.
- `fields` contains the facts specific to that event.
- `context` is the ambient scopes the record was produced under — a session, a
  turn, the tool call inside it — outermost first, so the list is a path. Each is a string identifying
  one unit of work (`"harpe.turn.id=209b1e14"`), kept apart from `fields` so
  ambient context can never collide with a producer's own keys.

`IntVal` and `BoolVal` are implementation adapters. At the call site, integers
and booleans are passed directly, just like strings and floats. A field can also
contain a list or nested map of `Value` values.

## Where your events go

A `Logger` defines only the interface, not the implementation, so an
implementation of it decides the storage format and the destination. The simplest
logger just throws the records away, which is the logger behind
`Logging.discard`. The framework ships `JsonlLogger` which appends JSON lines to a
file:

```json
{"time":"2024-07-09T16:00:00.400000Z","event":"harpe.tools.runCode.ran","fields":{"code":"…","exitCode":0,"compileSeconds":1.2,"runSeconds":0.3,"output":"…"},"context":[]}
```

JSONL encodes `time` as an RFC 3339 UTC string. The backend-independent
`Entry.time` remains epoch seconds, so database loggers can choose their native
timestamp representation and indexes.

To send them elsewhere, simply create a custom `Logger` and implement `logEntry`
and `close`:

```jo
class SqliteLogger(db: py.Dynamic)
  view Logger

  def logEntry(entry: Entry): Unit =
    // insert entry.time, entry.event, entry.fields, entry.context (serialize as you wish)
    ...

  def close(): Unit = db.close()
end
```

To send logs to multiple destinations, use `TeeLogger`:

```jo
val log = new TeeLogger([new JsonlLogger(path), new ViewLogger(capacity = 5000)])
```

That is how the [log viewer](/concepts/observability/) shows the logs live
without displacing the file.

## Framework events

The framework writes these itself, on every turn. Each name is stable, so a query
written against one keeps working. The turn events are what make a
[transcript](/concepts/transcript/) a reading of the log rather than a second
place to record it.

| Event | Fields | What it records |
|---|---|---|
| `harpe.tools.runCode.ran` | `code`, `compileSeconds`, `runSeconds`, `exitCode`, `output` | a program that compiled and ran |
| `harpe.tools.runCode.compileFailed` | `code`, `compileSeconds`, `compileError` | it did not compile |
| `harpe.tools.runCode.compileTimedOut` / `.timedOut` / `.approvalTimedOut` | | a clock ran out during the build, the run, or the approval the run was waiting on |
| `harpe.model.replied` | `provider`, `model` | one attempt that came back with a reply |
| `harpe.model.failed` | `provider`, `model`, `error`, `status`, `retryable` | one attempt that did not, as attributable as a successful one. `status` is 0 when the request never reached the server |
| `harpe.model.retried` / `harpe.model.gaveUp` | `attempt`, `retryInSeconds` / `retries` | what the engine decided about the `harpe.model.failed` record just before it |
| `harpe.metering.usage` | `provider`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens` | one call billed in tokens. The one record with a codec of its own — see [Explicit contracts](/guides/data-bus-and-contracts/) |
| `harpe.tools.skills.read` / `.searched` | `name` / `query` | content reached through the skill tools |
| `harpe.turn.request` / `harpe.turn.response` | `data` | the driver's brackets around one turn |
| `harpe.turn.message` | `role`, and what that role carries | one message of the conversation, whoever said it |
| `harpe.turn.answered` / `harpe.turn.interrupted` | | the terminator that closes a turn |
| `harpe.turn.failed` | `error` | the same, for a turn that did not finish |

## Logging from your own tool

When you write a tool, the logger is already in scope inside the handler — just
call it. Import the channel and pick an event name prefixed with your agent:

```jo
import harpe.logging.logger
import harpe.Interact
import harpe.Tool
import harpe.Tool.*
import harpe.Toolset

val weather: Tool =
  Tool:
    name = "weather"
    description = "Look up the weather in a city"
    params = [Tool.strParam("city", "the city")]

// The route's work goes in a small function. It may use `logger` freely.
private def lookUp(city: String): ToolOutcome receives logger =
  logger.info("myagent.tools.weather.called", "looked up weather", "city" ~ city)
  new ToolOutcome:
    "Sunny in \{city}"
    "weather · \{city}"
```

## Quick reference

```jo
// emit (logger is in scope inside a tool handler)
logger.log(event, "k" ~ v, ...)                    // a data event
logger.logFields(event, fields)                     // the same, fields already a map
logger.info(event, message, ...)                    // an informational message
logger.warn(event, message, ...)                    // a warning
logger.error(event, message, ...)                   // an error

// install a Logger — where events go (in the driver's entry point)
Logging.withLogger(myLogger, () => run())           // myLogger: any Logger
Logging.withContext("myapp.session=42", () => ...)  // tag entries with a scope
Logging.discard                                     // a no-op Logger (tests, logging off)
new TeeLogger([first, second])                      // one entry, several destinations

// write your own Logger
interface Logger
  def logEntry(entry: Entry): Unit                  // the one method you implement
  def close(): Unit
end

class Entry(time: Float, event: String, fields: Map[String, Value], context: List[String])
```

Field values are `String`, `Int`, `Float`, `Bool`, `List[Value]`, or a nested
`Map`. Scalars are written bare at the call site.

Use `Logging.withContext` when several sessions share one logging destination.
Per-session destinations do not need that redundant scope. Nesting it is safe:
each scope is added to `context` rather than over the one enclosing it, so a
record keeps every scope it was produced under.

A scope is a **string, and an identity** — stable for the unit of work it names
and distinct between instances, by convention `"<dotted key>=<id>"`:

```jo
Logging.withContext("myapp.session=\{id}", () => runTurn())
```

Detail about the unit goes in the `fields` of the records produced under it,
where it can be queried, rather than in the name of the scope. That is what lets
a reader group a log by structure alone — see
[Observability](/concepts/observability/).
