+++
title = "Logging"
+++
Your agent keeps a **structured log**: one typed event per thing that happens —
every `runCode` execution and every model call out of the box, plus anything you
log from the tools you write. Each event is a record with typed fields rather than
free text, which makes it the raw material for usage reports, billing, and stats.

*Where* those events go is not fixed. A `Logger` — the thing you install once —
decides the format and the destination. The framework ships one that appends JSON
lines to a file, but you can point the same events at a database or a metrics
service instead (see [Sending logs somewhere else](#sending-logs-somewhere-else)).
The examples below assume that default JSON file where they show concrete output.
swap in your own `Logger` and the events are identical, only their storage changes.

## Three properties

The logging mechanism is built around three properties:

- **Structural.** Every event is a typed record — a `category` and named fields,
  not a formatted string. Fields may contain scalars, arrays, or nested records.
  You *query and aggregate* it (per session, per category,
  summing tokens) rather than grepping text.

- **Extensible.** A new kind of event is a new category you emit. A new
  destination is a `Logger` you install. The two are independent and the wiring
  never grows — one channel carries everything, from `runCode` to your own tools.

- **Contextual.** Applications using a shared destination can stamp events with
  ambient context such as the session or chat that produced them. Applications
  storing one file per session already carry that identity in the file path.

## Where your events go

The bundled drivers use `JsonlLogger` to append turn events to each session's log.
The application owns the file layout. These examples use
`logs/sessions/<session>.jsonl` as a representative path:

```json
{"time":"2024-07-09T16:00:00.400000Z","category":"harpe.tools.runCode","code":"…","compiled":true,"exitCode":0,"compileSeconds":1.2,"runSeconds":0.3,"output":"…"}
```

With events in a JSON file, read them with anything that speaks JSON — `jq` is quickest:

```sh
# every runCode event, newest last
jq 'select(.category=="harpe.tools.runCode")' logs/sessions/<session>.jsonl

# just the failures
jq 'select(.category=="harpe.tools.runCode" and .compiled==false)' logs/sessions/<session>.jsonl
```

Wherever the events go, each has the same shape: a **`category`**, a **`time`**,
and the event's own fields. Shared destinations may additionally attach context.
JSONL encodes `time` as an RFC 3339 UTC string. The backend-independent
`Entry.time` remains epoch seconds, so database loggers can choose their native
timestamp representation and indexes.
The two categories logged for you:

- **`harpe.tools.runCode`** — one per program the agent runs: `code`, `compiled`,
  `compileSeconds`, and — depending on the outcome — `runSeconds`, `exitCode`,
  `output`, or a `compileError`.
- **`harpe.model`** — one per model call: `provider`, `model`, `inputTokens`,
  `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`. This is your token-usage
  feed for billing and auditing.

  `inputTokens` is the total input the provider processed, cached tokens
  included, and means the same thing on every provider — the adapters normalize
  the counts, which providers report on different bases. The two cache fields
  break that total down, so a price table applies the discounted cache rates to
  them and the base rate to the remainder. Both read 0 when a provider reports no
  cache detail, which is indistinguishable here from a provider that cached
  nothing. See [Prompt Caching](/guides/prompt-caching/).

## Logging from your own tool

When you write a tool, the logger is already in scope inside the handler — just
call it. Import the channel and pick a category named after your agent:

```jo
import harpe.logging.logger
import harpe.Tool
import harpe.Tool.*

val weather: Tool =
  Tool:
    name = "weather"
    description = "Look up the weather in a city"
    params = [Tool.strParam("city", "the city")]

// The route's work goes in a small function. It may use `logger` freely.
private def lookUp(city: String): ToolOutcome receives logger =
  logger.info("myagent.tools.weather", "looked up weather", "city" ~ city)
  new ToolOutcome("Sunny in \{city}", "weather · \{city}")
```

Add the spec to the agent and the route to the turn:

```jo
tools = [runCode, weather]
tools = runCode.toolset() ++ weather.toolset()
```

Now every call to your tool writes a `myagent.tools.weather` record, already
stamped with the session it ran in.

### What to log

- **Facts as fields, bare.** `logger.log("myagent.tools.weather", "city" ~ city, "hits" ~ 3, "cached" ~ true)`.
  Strings, numbers, and booleans go in directly — no wrappers.
- **Messages with a severity.** For something an operator should notice, use the
  helpers: `logger.info`, `logger.warn`, `logger.error`.

  ```jo
  logger.warn("myagent.model", "rate limited, retrying", "attempt" ~ 3)
  ```

  The message lands under an `"info"`/`"warning"`/`"error"` key. Extra fields ride
  alongside. Pull them out later with `jq 'select(has("error"))'`.

### Naming your category

A category is a **stable, dotted name** — like a logger name — that identifies the
kind of record: `"myagent.tools.weather"`. Prefix it with your agent's name so it
never collides with the framework's `harpe.*` categories, and so you can filter a
whole subtree at once (`jq 'select(.category | startswith("myagent"))'`). Keep it
stable once you've written queries against it — treat it as a data contract, not
something to rename when you move code. Define it once as a constant near the tool:

```jo
private def weatherCategory: String = "myagent.tools.weather"
```

## Reading and querying

With JSONL storage, each event is one self-describing line, so ordinary tools
answer most questions. A database backend supports equivalent queries over the
same fields and categories. A few `jq` starting points:

```sh
# token usage in one session
jq -s 'map(select(.category=="harpe.model"))
       | {inTokens: (map(.inputTokens) | add),
          outTokens: (map(.outputTokens) | add)}' logs/sessions/<session>.jsonl

# all warnings and errors, across every category
jq 'select(has("warning") or has("error"))' logs/sessions/<session>.jsonl
```

## Sending logs somewhere else

To change where session events go, change the logger selected by the driver:

```jo
val sessionLog = new JsonlLogger(sessionPath)
```

Swap `JsonlLogger` for any `Logger` — including one you write. A `Logger` implements
just `logEntry` (store one event) and `close`. An `entry` gives you `entry.time`,
`entry.category`, and `entry.fields` to persist however you like:

```jo
class SqliteLogger(db: py.Dynamic)
  view Logger

  def logEntry(entry: Entry): Unit =
    // insert entry.time, entry.category, and entry.fields (serialize as you wish)
    ...

  def close(): Unit = db.close()
end
```

`agent/logging/JsonlLogger.jo` is a complete `Logger` to copy from — it shows
how to turn `entry.fields` (including nested maps) into JSON. You can also **wrap**
`JsonlLogger` instead of replacing it — see below.

## Building usage, billing, and stats

The log is a stream of typed events keyed by category. A shared log can additionally
carry session context. Build reporting on it in one of two places.

**Offline, over the stored events.** For dashboards, invoices, or audits, process
the stored session events with `jq` or another reporting tool. Filter by category
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

Every entry the meter sees carries its `context` (whose session it is) and a stable
`category` (so it can trust the fields), which is all a per-session counter needs.
For billing, the `harpe.model` events give you `inputTokens`/`outputTokens` per
call already — apply your price table to turn them into cost.

**Charge for a new thing → log a new category.** Anything else you want to meter
is just a new category you emit. To bill on, say, an external API a tool calls:

```jo
logger.log("myagent.tools.search", "queries" ~ n, "vendorCost" ~ cost)
```

Your reports and your `UsageMeter` pick it up with no other change — a new signal
is just a new category, and the wiring (one installed `Logger`) stays put.

## Quick reference

```jo
// emit (logger is in scope inside a tool handler)
logger.log(category, "k" ~ v, ...)                 // a data event
logger.info  / warn / error(category, message, ...) // a message at a severity

// install a Logger — where events go (in the driver's entry point)
Logging.withLogger(myLogger, () => run())           // myLogger: any Logger
Logging.discard                                     // a no-op Logger (tests, logging off)

// write your own Logger
interface Logger
  def logEntry(entry: Entry): Unit                  // the one method you implement
  def close(): Unit
end

class Entry(time: Float, category: String, fields: Map[String, Value])
```

Field values are `String`, `Int`, `Float`, `Bool`, `List[Value]`, or a nested
`Map`. Scalars are written bare at the call site.

Use `Logging.withContext` when several sessions share one logging destination.
Per-session destinations do not need that redundant field.

## Turn history and transcript loading

Turn execution uses this same channel. There is no second session-journal API.
The framework emits stable `harpe.turn.started`, `harpe.turn.message`, and
terminal `harpe.turn.answered` / `interrupted` / `failed` categories.

Applications decide how session events are stored and correlated. Producers emit
through `logger` without depending on that policy. `Transcript.turns` projects an
ordered event stream into structured turns and outcomes. `Transcript.fromEntries`
derives the model's conversation history from that projection.
