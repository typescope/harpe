+++
title = "Logging"
+++
Harpe can write a **structured log** for selected operations, including every
`runCode` execution and model call, plus anything you log from your own tools.
Each event is a record with named, JSON-shaped fields rather than free text. This
makes logs useful for usage reports, billing, and statistics.

*Where* those events go is not fixed. A `Logger` — the thing you install once —
decides the format and the destination. The framework ships one that appends JSON
lines to a file, but you can point the same events at a database or a metrics
service instead (see [Sending logs somewhere else](#sending-logs-somewhere-else)).
The examples below use that JSON backend where they show concrete output. Swap
in your own `Logger` and the events remain the same. Only their storage changes.

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

## What a structured log entry is

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
  turn, the tool call inside it — innermost first. Each is a string identifying
  one unit of work (`"harpe.turn.id=209b1e14"`), kept apart from `fields` so
  ambient context can never collide with a producer's own keys.

`IntVal` and `BoolVal` are implementation adapters. At the call site, integers
and booleans are passed directly, just like strings and floats. A field can also
contain a list or nested map of `Value` values.

Entries with the same `event` carry the same field names and meanings, so the
name acts as the record's schema tag. Two records carrying different fields are
two events and take two names. The `Logger` decides how this entry is encoded and
stored.

## Where your events go

The bundled drivers use `JsonlLogger` to append session events to each session's log.
The application owns the file layout. These examples use
`logs/sessions/<session>.jsonl` as a representative path:

```json
{"time":"2024-07-09T16:00:00.400000Z","event":"harpe.tools.runCode.ran","fields":{"code":"…","exitCode":0,"compileSeconds":1.2,"runSeconds":0.3,"output":"…"},"context":[]}
```

With events in a JSON file, read them with anything that speaks JSON — `jq` is quickest:

```sh
# every program the agent tried, newest last
jq 'select(.event | startswith("harpe.tools.runCode"))' logs/sessions/<session>.jsonl

# just the ones that did not compile
jq 'select(.event=="harpe.tools.runCode.compileFailed")' logs/sessions/<session>.jsonl
```

Wherever the events go, each has the same shape: a **`time`**, an **`event`**,
the event's own **`fields`**, and the **`context`** scopes it was produced
under. Producer fields sit under `fields` rather than beside `time` and
`event`, so a field may be named anything without colliding with the record's
own keys.
JSONL encodes `time` as an RFC 3339 UTC string. The backend-independent
`Entry.time` remains epoch seconds, so database loggers can choose their native
timestamp representation and indexes.
The main framework events are:

- **`harpe.tools.runCode.ran`** — a program that compiled and ran: `code`,
  `compileSeconds`, `runSeconds`, `exitCode`, `output`.
- **`harpe.tools.runCode.compileFailed`** — it did not compile: `code`,
  `compileSeconds`, `compileError`.
- **`harpe.tools.runCode.compileTimedOut`** / **`.timedOut`** /
  **`.approvalTimedOut`** — a clock ran out during the build, the run, or the
  approval the run was waiting on. `startswith("harpe.tools.runCode")` reads
  every program the agent tried, however it ended.
- **`harpe.model.replied`** — one per attempt that came back with a reply:
  `provider`, `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
  `cacheWriteTokens`. This is your token-usage feed for billing and auditing.
- **`harpe.model.failed`** — one per attempt that did not: the same `provider`
  and `model`, so a failed request is as attributable as a successful one, plus
  `error`, the HTTP `status` (0 when the request never reached the server), and
  `retryable`, the classification the engine acted on.

  `inputTokens` is the total input the provider processed, cached tokens
  included, and means the same thing on every provider — the adapters normalize
  the counts, which providers report on different bases. The two cache fields
  break that total down, so a price table applies the discounted cache rates to
  them and the base rate to the remainder. Both read 0 when a provider reports no
  cache detail, which is indistinguishable here from a provider that cached
  nothing. See [Prompt Caching](/guides/prompt-caching/).
- **`harpe.model.retried`** / **`harpe.model.gaveUp`** — what the engine DECIDED
  about a failed attempt, as distinct from the attempt itself. A retry carries
  `attempt` and `retryInSeconds`, a give-up carries `retries` (0 when the failure
  was never retryable). The failure they respond to is the `harpe.model.failed`
  record just before them.

`startswith("harpe.model")` reads the whole story of talking to a model — what
was attempted, and what the engine decided about it.
- **`harpe.tools.skills.read`** (`name`) and **`harpe.tools.skills.searched`**
  (`query`) — content reached through the skill tools.
- **`harpe.turn.*`** — the conversation itself: `started`, `message`, and one of
  `answered` / `interrupted` / `failed`. The engine writes these on every turn,
  so a [transcript](/concepts/transcript/) is a reading of the log rather than a
  second place to record it.

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

Add the spec to the agent and the route to the turn:

```jo
val weatherTools =
  Toolset.of: weather, (input: ToolInput, _: Interact) =>
    lookUp(input["city"])

val tools = runCode.toolset() ++ weatherTools
```

Now every call to your tool writes a `myagent.tools.weather.called` record. A
per-session destination identifies the session through its path. A shared
destination can attach a session scope with `Logging.withContext`.

### What to log

- **Facts as fields, bare.** `logger.log("myagent.tools.weather.called", "city" ~ city, "hits" ~ 3, "cached" ~ true)`.
  Strings, numbers, and booleans go in directly — no wrappers.
- **Messages with a severity.** For something an operator should notice, use the
  helpers: `logger.info`, `logger.warn`, `logger.error`.

  ```jo
  logger.warn("myagent.model.retried", "rate limited, retrying", "attempt" ~ 3)
  ```

  The message lands under an `"info"`/`"warning"`/`"error"` key. Extra fields ride
  alongside. Pull them out later with `jq 'select(.fields|has("error"))'`.

### Naming your event

An event name is a **stable, dotted name** whose LAST segment says what happened:
`"myagent.tools.weather.called"`. Everything before it is a filter unit, so derive
the prefix from the namespace the code lives in — that keeps it from colliding
with the framework's `harpe.*` names and lets you read a whole subtree at once
(`jq 'select(.event | startswith("myagent"))'`).

If two of your records carry different fields, they are two events and want two
names — a discriminator field standing in for that means the name stopped one
segment short. Keep each stable once you have written queries against it: treat it
as a data contract, not something to rename when you move code. Define it once as
a constant near the tool:

```jo
private def weatherCalledEvent: String = "myagent.tools.weather.called"
```

## Reading and querying

With JSONL storage, each event is one self-describing line, so ordinary tools
answer most questions. A database backend supports equivalent queries over the
same fields and event names. A few `jq` starting points:

```sh
# token usage in one session
jq -s 'map(select(.event=="harpe.model.replied"))
       | {inTokens: (map(.fields.inputTokens) | add),
          outTokens: (map(.fields.outputTokens) | add)}' logs/sessions/<session>.jsonl

# all warnings and errors, across every event
jq 'select(.fields|has("warning") or has("error"))' logs/sessions/<session>.jsonl
```

## Sending logs somewhere else

To change where session events go, change the logger selected by the driver:

```jo
val sessionLog = new JsonlLogger(sessionPath)
```

Swap `JsonlLogger` for any `Logger` — including one you write. A `Logger` implements
just `logEntry` (store one event) and `close`. An `entry` gives you `entry.time`,
`entry.event`, `entry.fields`, and `entry.context` to persist however you like:

```jo
class SqliteLogger(db: py.Dynamic)
  view Logger

  def logEntry(entry: Entry): Unit =
    // insert entry.time, entry.event, entry.fields, entry.context (serialize as you wish)
    ...

  def close(): Unit = db.close()
end
```

`agent/logging/JsonlLogger.jo` is a complete `Logger` to copy from — it shows
how to turn `entry.fields` (including nested maps) into JSON. You can also **wrap**
`JsonlLogger` instead of replacing it — see below.

For two destinations rather than one, `TeeLogger` hands each entry to every
logger it holds, in order:

```jo
val log = new TeeLogger([new JsonlLogger(path), new TailLogger(capacity = 5000)])
```

That is how the [journal viewer](/concepts/observability/) reads a session as it
runs without displacing the file.

## Building usage, billing, and stats

The log is a stream of structured events keyed by name. A shared log can additionally
carry session context. Build reporting on it in one of two places.

**Offline, over the stored events.** For dashboards, invoices, or audits, process
the stored session events with `jq` or another reporting tool. Filter by event
and aggregate the fields you care about.

**Live, as a wrapping `Logger`.** For real-time metering, wrap `JsonlLogger` in a
`Logger` that tallies as events flow through, then delegates so they're still
stored:

```jo
class UsageMeter(inner: Logger, meter: Meter)
  view Logger

  def logEntry(entry: Entry): Unit =
    meter.record(entry)      // update per-session counters / push to a metrics service
    inner.logEntry(entry)    // and still persist

  def close(): Unit = inner.close()
end

// in your driver's entry point:
Logging.withLogger(new UsageMeter(new JsonlLogger(path), meter), () => serve())
```

Every entry the meter sees carries a stable `event`. When the application uses
`Logging.withContext`, the configured context appears as a scope in
`entry.context`. Together, these identify the event shape and the session a
shared destination should attribute it to.
For billing, the `harpe.model.replied` events give you `inputTokens`/`outputTokens` per
call already — apply your price table to turn them into cost.

**Charge for a new thing → log a new event.** Anything else you want to meter
is just a new name you emit. To bill on, say, an external API a tool calls:

```jo
logger.log("myagent.tools.search", "queries" ~ n, "vendorCost" ~ cost)
```

Your reports and your `UsageMeter` pick it up with no other change — a new signal
is just a new event, and the wiring (one installed `Logger`) stays put.

That openness is right while a number is something you watch. Once it is something
you invoice from, give the record a codec — see
[Explicit contracts for business logic](#explicit-contracts-for-business-logic).

## Explicit contracts for business logic

The log is deliberately open. Any producer can invent a name and any fields, and
nothing validates them — that is what makes a new signal cost one line. It is the
right trade for diagnostics, where a record is read by a person with `jq` and a
missing field is an inconvenience.

It is the wrong trade when real logic depends on the record. An invoice computed
from `harpe.model.replied`, or a conversation replayed out of the log, is business
logic reading a wire format, and an open wire gives it nothing to hold on to:

- **Documentation.** The field list lives in whichever call site last emitted it.
  A consumer learns the shape by reading a producer, or by reading a sample record
  and hoping it was typical.
- **Contract.** Renaming a field is not a compile error. The producer changes, the
  consumer goes on asking for a key nobody writes, and gets a default back instead
  of a failure.
- **Versioning.** A log outlives the code that wrote it. Nothing on a record says
  which shape it was written in, so nothing downstream can decide what to do with
  an old one.

**For those records, declare the type.** Define a class for the domain data, and one
module that owns the event name, the encoder, and the decoder — together, in one
file, so the two halves cannot drift apart. The contract stops being something
everyone remembers and becomes something the compiler holds:

```jo
class Charge(model: String, inputTokens: Int, outputTokens: Int, cents: Int)

section ChargeLog
  def chargedEvent: String = "myagent.billing.charged"

  def charged(charge: Charge): Unit receives logger =
    logger.log:
      chargedEvent
      "model"        ~ charge.model
      "inputTokens"  ~ charge.inputTokens
      "outputTokens" ~ charge.outputTokens
      "cents"        ~ charge.cents

  def decode(entry: Entry): Charge = ...
end
```

Three rules turn that from a convention into a contract:

- **One type, one event name.** The name is the record's schema tag, so a change of
  shape is a change of name — never a `version` field, and never a discriminator
  that lets one name mean two things.
- **Encode and decode in one file.** Two hand-written halves that agree only by
  inspection are how a renamed key silently costs you records.
- **Decode fails loudly.** A field that is absent or at the wrong type means the
  record did not come from this codec. Substituting an empty value bills a charge
  of zero, which reads as a fact rather than as the failure it is.

The point is not ceremony. It is that the contract can now only be broken on
purpose. Change `Charge` and the codec stops compiling until both halves are
updated; on the open wire the same edit compiles, ships, and shows up later as a
wrong number on an invoice with nothing to say when it started.

`harpe.turns.TurnLog` is the worked example. It owns `harpe.turn.message` and the
three terminators, encodes a `Message` into a record and decodes one back, and
aborts naming the field when a record does not match. Everything else in the log
stays open — only the records something is built on pay for a codec.

## Quick reference

```jo
// emit (logger is in scope inside a tool handler)
logger.log(event, "k" ~ v, ...)                    // a data event
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

## Turn history and transcript loading

The provided `Journal` transcript writes through this same channel.
The framework emits a stable `harpe.turn.message` for every message in a turn
and terminal `harpe.turn.answered` / `interrupted` / `failed` events. Each
record also carries the turn that produced it as a `harpe.turn.id` scope in
`context`, so records are grouped by that rather than by where they sit in the
stream. Framework scope keys are dotted for the same reason event names are —
an application's own scopes share the list and must not collide.

Applications decide how session events are stored and correlated. Producers emit
through `logger` without depending on that policy. `Journal.records` projects an
ordered event stream into structured turns and outcomes. `Journal.load` derives
the model's conversation history from an existing JSONL journal. See
[Transcript](/concepts/transcript/) for the complete recording and replay model.
