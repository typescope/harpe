# The Harpe logging infrastructure

Harpe's logging layer (`agent/src/logging/`) is a small **structured event log**:
each record is a typed value, not a formatted string, and *where* and *how* it is
stored is decided by a pluggable backend. It is the foundation the framework — and
you — build observability on: the `runCode` audit trail today, and billing, usage,
and stats tomorrow, all from the same event stream.

Two ideas keep it decoupled and extensible:

- **Standardize the record, not the content.** Every event is an `Entry` with a
  time, a category, and an open bag of typed fields. The framework never names
  *your* fields.
- **Standardize the interchange, make the backend pluggable.** Producers hand
  `Entry`s to a `Logger`; a `Logger` owns the format (JSON, sqlite, logfmt, a
  metrics API) and the destination (a file, a database, a socket). Producers and
  backends vary independently — `N + M`, not `N × M`.

## The record

```jo
class Entry(time: Float, category: String, fields: Map[String, Value])

type Value = (String | Float | IntVal | BoolVal | Map[String, Value]) :- [IntVal, BoolVal]
```

An `Entry` is **when** it happened, **which** category it belongs to, and its
named **fields**. A field `Value` is a scalar — text, number, integer, boolean —
or a nested `Map` of them. Scalars go in bare; the duck-type adapters box `Int`
and `Bool` on the way in, so a producer never writes a wrapper:

```jo
logger.log("harpe.tools.runCode", "code" ~ src, "exitCode" ~ 0, "compiled" ~ true, "compileSeconds" ~ 1.2)
```

The block-call form reads well when there are several fields:

```jo
logger.log:
  "harpe.tools.runCode"
  "code"           ~ src
  "compiled"       ~ true
  "exitCode"       ~ 0
```

(Jo forbids more than one numeric/boolean primitive in a union, which is why
`Int` and `Bool` are boxed as `IntVal`/`BoolVal` behind the adapters; you never
see that at a call site.)

## Category — the schema tag

A **category** is a stable, dotted, reverse-namespaced identifier, like a logger
name: `"harpe.tools.runCode"` (namespace + producer). It does three jobs:

- **Uniqueness in an open set.** Any producer — third-party included — can mint a
  category; reverse-namespacing keeps them from colliding.
- **Subtree filtering.** `jq 'select(.category | startswith("harpe.tools"))'`
  slices all tool events; `startswith("harpe.")` all framework events.
- **Schema tag.** Entries sharing a category share the same field shape, so a
  consumer can rely on the columns being there.

Because downstream consumers filter on it, a category is a **data contract**:
derive it from the namespace once, then keep it stable across refactors. Each
producer owns its category as a named constant (namespace-level `val` is not a
thing in Jo — use `def`):

```jo
private def runCodeCategory: String = "harpe.tools.runCode"
```

## Severity — a field convention, not a level

Most records are pure data: the outcome lives in the fields
(`"compiled" ~ false`) or the category, so they carry **no** severity — there is
no constant-`info` noise. A record that instead has a human-facing diagnostic
message uses one reserved field key — `"info"`, `"warning"`, or `"error"` — whose
value *is* the message. The helpers write it:

```jo
logger.warn("harpe.model", "rate limited, retrying", "attempt" ~ 3)
// → {"time":…, "category":"harpe.model", "attempt":3, "warning":"rate limited, retrying"}
```

Those three keys are reserved and mutually exclusive; structured context goes in
sibling fields. Filter by key existence: `jq 'select(has("error"))'`, or
`select(has("warning") or has("error"))` for warn-and-up.

## Context — who / which session

Records often need the *ambient* "which user, which session" of a turn. That is
application-defined, so the framework carries it as an open `Map` and stamps it
onto every entry — nested under a single key, never merged flat, so it can never
collide with a producer's own fields:

```jo
Logging.withContext("context", Map("session" ~ id), () => agent.runTurn(...))
// every entry the turn emits gains:  "context": { "session": "…" }
```

`withContext` decorates the ambient logger for the dynamic extent of the work, so
it composes and nests. Drivers set it at the turn boundary; producers stay
oblivious.

## The channel and the backend

Producers emit through one context parameter; a driver installs the backend once
and closes it on exit.

```jo
param logger: Logger

section Logging
  def withLogger[T](backend: Logger, work: () => T receives logger): T
  def withContext[T](key: String, context: Map[String, Value], work: () => T receives logger): T
  def discard: Logger    // a no-op logger
end
```

A driver's `main` wraps its run loop:

```jo
Logging.withLogger(new JsonlLogger(workspace.relative("logs/agent.jsonl")), () => serve())
```

`withLogger` installs the backend behind a `SerialLogger` — a lock wrapper that
serializes writes, so a backend need not be thread-safe (runs are concurrent).

### Tools read the logger live

A tool does not capture a logger when it is built; `Tool.run` is
`ToolInput => RunOutcome receives logger`, so it reads the *ambient* logger at
call time. That is what lets a per-turn `withContext` reach an already-built tool.
The consequence: a turn must execute inside a `with logger` scope on its thread —
the cli loop, each web request, and each telegram chat-worker all establish one.
(See [context-params-and-threads](#context-parameters-and-threads).)

## The `Logger` interface — and writing a backend

```jo
interface Logger
  def log(category: String, fields: ..(String ~ Value)): Unit   // default: builds the Entry
  def info(category: String, message: String, fields: ..(String ~ Value)): Unit   // default
  def warn(category: String, message: String, fields: ..(String ~ Value)): Unit   // default
  def error(category: String, message: String, fields: ..(String ~ Value)): Unit  // default
  def logEntry(entry: Entry): Unit   // the one method a backend implements
  def close(): Unit
end
```

`log`/`info`/`warn`/`error` are defaults that assemble an `Entry`; a backend
implements only `logEntry` (and `close`). The framework ships one backend,
`JsonlLogger(path)`, which appends every category to a **single** JSON file with
`category` as a field — one file keeps consumption simple (`jq` slices by
category), and it stays a plain append.

A third party adds a backend by implementing `logEntry`. Backends compose by
decoration — `SerialLogger` and `ContextLogger` are exactly that, a `Logger`
wrapping a `Logger`. Routing by category, fan-out to several sinks, a sqlite
table: each is a small `Logger` you write, so the framework ships none of them.

```jo
class SqliteLogger(db: Connection)
  view Logger
  def logEntry(entry: Entry): Unit = ...   // INSERT time, category, json(fields)
  def close(): Unit = db.close()
end
```

## Building on top: billing, usage, stats

The log is an append-only stream of typed events keyed by category and tagged with
session context. That is a general substrate; observability features are consumers
of it, added in one of two places.

**Offline, over the JSONL.** Because every record is one self-describing JSON line
with a `category` and a `context`, ordinary tools answer most questions:

```sh
# total compile+run seconds per session
jq -s 'map(select(.category=="harpe.tools.runCode"))
       | group_by(.context.session)
       | map({session: .[0].context.session,
              seconds: (map(.compileSeconds + (.runSeconds // 0)) | add)})' logs/agent.jsonl
```

Good for reports, dashboards fed from the file, and after-the-fact auditing.

**In-process, as a `Logger` decorator.** For live billing or metrics, wrap the
base backend in a `Logger` that tallies as entries flow through, then delegates:

```jo
class UsageMeter(inner: Logger, meter: Meter)
  view Logger
  def logEntry(entry: Entry): Unit =
    meter.record(entry)      // update per-session counters, emit to a metrics service, …
    inner.logEntry(entry)    // and still persist
  def close(): Unit = inner.close()
end

// install it in the driver, still writing to the file underneath:
Logging.withLogger(new UsageMeter(new JsonlLogger(path), meter), () => serve())
```

Because context is nested under `"context"`, the meter always knows *whose* event
it is; because categories are stable schema tags, it can trust the fields it reads
(`harpe.tools.runCode` → timings; a future `harpe.model` → token counts and cost).

**New signals are new producers.** Billing on model usage, for instance, needs a
model wrapper that emits a `harpe.model` entry per call with `inputTokens`,
`outputTokens`, and `cost`. The wrapper adds a category and fields; the meter and
the JSONL pick it up with no plumbing change. That is the point of the single
channel: new observables add producers and new destinations add backends, but the
wiring — one `param`, one `withLogger`, one `withContext` — never grows.

## Files

| File | What it holds |
|------|---------------|
| `Entry.jo` | `Entry`, `Value`, and the category + severity conventions |
| `Logger.jo` | the `Logger` interface (`log`/`info`/`warn`/`error`/`logEntry`/`close`) |
| `JsonlLogger.jo` | the shipped single-file JSON backend |
| `NullLogger.jo` | the no-op backend (`Logging.discard`) |
| `SerialLogger.jo` | the lock decorator installed by `withLogger` |
| `ContextLogger.jo` | the context-nesting decorator installed by `withContext` |
| `Logging.jo` | the `logger` param + `withLogger` / `withContext` / `discard` |

## Context parameters and threads

The logging channel is a Jo context parameter, which is dynamically scoped to the
**calling thread** and does not cross into threads spawned underneath it. A driver
that runs turns on worker threads (telegram) captures the base logger as a value
and re-installs it on the worker; a thunk that should read the logger *dynamically*
(rather than freeze the current one) must be typed `() => T receives logger`. These
mechanics are the subject of the framework's threading notes; the takeaway for
logging is that a turn always runs inside a `with logger` scope, and `withContext`
layers onto it.
