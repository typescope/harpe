+++
title = "Logging"
+++
Your agent keeps a **structured log**: one typed event per thing that happens —
every `runCode` execution and every model call out of the box, plus anything you
log from the tools you write. Each event is a record (typed fields, not free text)
tagged with the session it came from, which makes it the raw material for usage
reports, billing, and stats.

*Where* those events go is not fixed. A `Logger` — the thing you install once —
decides the format and the destination. The framework ships one that appends JSON
lines to a file, but you can point the same events at a database or a metrics
service instead (see [Sending logs somewhere else](#sending-logs-somewhere-else)).
The examples below assume that default JSON file where they show concrete output.
swap in your own `Logger` and the events are identical, only their storage changes.

## Three properties

The logging mechanism is built around three properties:

- **Structural.** Every event is a typed record — a `category` and named fields,
  not a formatted string. You *query and aggregate* it (per session, per category,
  summing tokens) rather than grepping text.

- **Extensible.** A new kind of event is a new category you emit. A new
  destination is a `Logger` you install. The two are independent and the wiring
  never grows — one channel carries everything, from `runCode` to your own tools.

- **Contextual.** Every event is stamped automatically with the ambient context —
  which session/chat produced it — so any slice ("this session's token usage")
  falls straight out of the data.

## Where your events go (default)

Out of the box the installed `Logger` is `JsonlLogger`, which appends every event
as one JSON line to `logs/agent.jsonl` under your agent's working directory:

```json
{"time":1720531200.4,"category":"harpe.tools.runCode","code":"…","compiled":true,"exitCode":0,"compileSeconds":1.2,"runSeconds":0.3,"output":"…","context":{"session":"20260709T101500-ab12"}}
```

With events in a JSON file, read them with anything that speaks JSON — `jq` is quickest:

```sh
# every runCode event, newest last
jq 'select(.category=="harpe.tools.runCode")' logs/agent.jsonl

# just the failures
jq 'select(.category=="harpe.tools.runCode" and .compiled==false)' logs/agent.jsonl
```

Wherever the events go, each has the same shape: a **`category`** (what kind
of event), a **`time`**, the event's own fields, and a **`context`** identifying
the session/chat it happened in. The two categories logged for you:

- **`harpe.tools.runCode`** — one per program the agent runs: `code`, `compiled`,
  `compileSeconds`, and — depending on the outcome — `runSeconds`, `exitCode`,
  `output`, or a `compileError`.
- **`harpe.model`** — one per model call: `provider`, `model`, `inputTokens`,
  `outputTokens`. This is your token-usage feed for billing and auditing. It is
  emitted by the built-in Anthropic/OpenAI models and tagged with the session that
  made the call.

## Logging from your own tool

When you write a tool, the logger is already in scope inside the handler — just
call it. Import the channel and pick a category named after your agent:

```jo
import harpe.logging.logger
import harpe.Tool
import harpe.Tool.*

def weatherTool(): Tool =
  new Tool:
    name = "weather"
    description = "Look up the weather in a city"
    params = [Tool.strParam("city", "the city")]
    run = input => lookUp(input.string("city"))

// The handler's work goes in a small function. It may use `logger` freely.
private def lookUp(city: String): RunOutcome receives logger =
  logger.info("myagent.tools.weather", "looked up weather", "city" ~ city)
  new RunOutcome("Sunny in \{city}", "weather · \{city}", [])
```

Add it where your driver builds the toolset:

```jo
val tools = Defaults.tools(610.0) ++ [weatherTool()]
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

With the default JSON file, each event is one self-describing line, so ordinary
tools answer most questions. (Point events at a database instead and you'd write
the equivalent queries in SQL — same fields, same categories.) A few `jq` starting
points:

```sh
# tokens per session (the billing query)
jq -s 'map(select(.category=="harpe.model"))
       | group_by(.context.session)
       | map({session: .[0].context.session,
              inTokens:  (map(.inputTokens)  | add),
              outTokens: (map(.outputTokens) | add)})' logs/agent.jsonl

# how many runs per session
jq -s 'group_by(.context.session) | map({session: .[0].context.session, runs: length})' logs/agent.jsonl

# all warnings and errors, across every category
jq 'select(has("warning") or has("error"))' logs/agent.jsonl
```

## Sending logs somewhere else

By default your driver installs `JsonlLogger`. To change where events go, edit the
one line in your driver's entry point (`Cli.jo` / `Web.jo` / `Telegram.jo`) that
constructs it:

```jo
Logging.withLogger(new JsonlLogger(wspace.relative("logs/agent.jsonl")), () => serve())
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

The log is a stream of typed events keyed by category and tagged with the session.
Build reporting on it in one of two places.

**Offline, over the stored events.** For dashboards, invoices, or audits, run `jq`
(or any script) over `logs/agent.jsonl` — the queries above are the starting shapes.
Group by `.context.session`, filter by `.category`, sum the fields you care about.

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

Field values are `String`, `Int`, `Float`, `Bool`, or a nested `Map` of them — all
written bare at the call site.

The framework tags each turn's events with their session automatically (via
`Logging.withContext`). You only need this if you write your own driver loop.
