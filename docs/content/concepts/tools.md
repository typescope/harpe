+++
title = "Tools"
weight = 3
+++
A tool is the agent's way to *act*. The model, mid-turn, chooses to call a tool by
name with arguments; your handler runs host-side and returns text the model reads
on the next step. Every agent ships with `runCode` (write a Jo program, compile it
against the sandbox, run it) — you extend the toolset by writing your own tools and
adding them in `Config.jo`.

## What a tool is

```jo
class Tool(name, description, params, run)
```

- **`name`** — how the model calls it.
- **`description`** — prose the model reads to decide *when* to call it. Write it
  for the model, not for yourself.
- **`params`** — the typed inputs it accepts (below).
- **`run`** — your host-side handler: it gets the call's typed input and returns a
  `RunOutcome`.

You describe all of this in Jo; each provider renders its own wire spec from it, so
you never hand-write JSON schema.

## What ships

`Defaults.tools()` gives every agent:

- **`runCode`** — compile and run a Jo program in the sandbox; the agent's main way
  to act.
- **skill tools** — `skillsList` / `skillsRead` / `skillsSearch`, read-only access
  to the agent's `skills/`.

and the drivers add **memory tools** — `updateMemory` / `readMemory` / `listMemory`,
the agent's working memory. You add yours alongside these.

## Writing a tool

Describe the parameters, read them typed, return a result:

```jo
import harpe.Tool
import harpe.Tool.*

def weatherTool(): Tool =
  new Tool("weather", "Look up the current weather in a city",
    [strParam("city", "the city to look up")],
    input => lookUp(input.string("city")))

// Keep the handler body in a small function (a multi-line lambda inside the
// constructor call doesn't parse); it may use `logger` freely.
private def lookUp(city: String): RunOutcome =
  new RunOutcome("Sunny in \{city}, 22°C", "weather · \{city}")
```

## Parameters

Each parameter has a name, a type, and a description the model reads. Four
constructors cover the schema types, all producing a **required** parameter:

```jo
strParam(name, description)    // string
intParam(name, description)    // integer
boolParam(name, description)   // boolean
numParam(name, description)    // number (float)
```

Read them from the call's `input` with typed accessors — a missing key yields a
zero value, or use the `…Or` variant for an explicit fallback:

```jo
input.string("city")           // "" if absent
input.int("count")             // 0 if absent
input.bool("verbose")          // false if absent
input.num("threshold")         // 0.0 if absent
input.intOr("count", 10)       // 10 if absent
```

## Returning a result

```jo
class RunOutcome(result, summary)
```

- **`result`** is the text fed back to the model — what it sees as the tool's
  output.
- **`summary`** is a one-line status for the console and logs (e.g. `"weather · Paris"`).

**Bound large output.** Context is finite, so don't feed the model a megabyte.
`elide(text, maxChars)` trims to a head-plus-tail excerpt with the middle marked.
The rule is **reference, don't inline**: return a bounded excerpt to the model and
log the full artifact, so nothing is lost (this is what `runCode` does — the elided
result to the model, the whole output to `logs/agent.jsonl`; see
[logging.md](@/concepts/logging.md)).

```jo
new RunOutcome(elide(output, 4000), "ran · 3.1s")
```

## Errors are safe

You don't have to catch everything. The engine runs every tool through a backstop
(`runSafely`), so if your handler throws — or `abort`s — the exception becomes an
*error* `RunOutcome` fed back to the model. The turn continues and the driver never
crashes. Return a clear message for expected failures; let unexpected ones raise.

## Adding your tool

Tools are assembled per session in your `Config.jo` — append yours to the defaults:

```jo
val tools = Defaults.tools() ++ memoryTools(memory) ++ [weatherTool()]
```

That is the whole wiring: the model now sees `weather` in its toolset and can call
it. (An agent with different needs can build the toolset from scratch instead of
starting from `Defaults.tools()`.)

## Logging from a tool

Inside a handler `logger` is in scope, so a tool can record what it did under its
own category:

```jo
private def lookUp(city: String): RunOutcome receives logger =
  logger.info("myagent.tools.weather", "looked up weather", "city" ~ city)
  new RunOutcome("Sunny in \{city}, 22°C", "weather · \{city}")
```

The event is stamped with the session automatically — ready for auditing or usage
reports. See [logging.md](@/concepts/logging.md).
