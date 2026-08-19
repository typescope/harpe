+++
title = "Tools"
+++
A tool is the agent's way to *act*. The model, mid-turn, chooses to call a tool by
name with arguments. Your handler runs host-side and returns text the model reads
on the next step. Every agent ships with `runCode` (write a Jo program, compile it
against the sandbox, run it) — you extend the toolset by writing your own tools and
adding them where the driver constructs its `Agent`.

## Tools and capabilities

Tools and capabilities sit on opposite sides of the generated-program boundary:

![The chat model calls runCode, a model-facing tool. runCode compiles a generated Jo program inside the guest boundary, where it can use only the typed capabilities granted by the application.](/img/tools-capabilities.svg)

A tool is offered directly to the chat model. Its handler runs host-side and
returns a result to the model. `runCode` is the tool that compiles and executes a
generated Jo program.

A [capability](/capabilities/overview/) is offered to that program through
`SandboxAPI.jo`. It is not a model tool and does not appear in the provider's
tool schema. The compiler checks its use before the program runs.

## What a tool is

`Tool` is an interface with four members:

```jo
interface Tool
  def name: String
  def description: String
  def params: List[ToolParam]
  def run(input: ToolInput): RunOutcome receives logger, callContext, currentInteract
end
```

- **`name`** — how the model calls it.
- **`description`** — prose the model reads to decide *when* to call it. Write it
  for the model, not for yourself.
- **`params`** — the typed inputs it accepts (below). Read every time a request is
  rendered, so a tool may derive its schema from live state.
- **`run`** — your host-side handler: it gets the call's typed input and returns a
  `RunOutcome`. Its `receives` clause is what puts the ambient `logger`, the
  driver's `callContext`, and `currentInteract` in scope inside the handler, as
  of the turn the call belongs to.

Most tools are nothing but those four parts, and the `Tool(...)` factory builds one
from them — that is the next section. A tool with logic of its own implements the
interface directly instead, which [Tools that own their
logic](#tools-that-own-their-logic) covers.

You describe all of this in Jo. Each provider renders its own wire spec from it, so
you never hand-write JSON schema.

See [Structured output](/concepts/structured-output/) for why Harpe usually keeps
machine-consumed data in the typed Jo program instead of formatting it as the
agent's final answer.

## What ships

`Defaults.tools(approvalDeadline)` provides:

- **`runCode`** — compile and run a Jo program in the sandbox. This is the agent's main way
  to act.
- **`uploadMedia`** — show an image or PDF from the data directory directly to
  the chat model.
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
  Tool:
    name = "weather"
    description = "Look up the current weather in a city"
    params = [strParam("city", "the city to look up")]
    run = input => lookUp(input.string("city"))

// Keep the handler body in a small function. It may use `logger` freely.
// Once a tool grows past that, give it a class instead — see below.
private def lookUp(city: String): RunOutcome =
  new RunOutcome("Sunny in \{city}, 22°C", "weather · \{city}", [])
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
input["city"]                  // the indexing form of `string`
```

## Returning a result

```jo
class RunOutcome(result, summary, media)
```

- **`result`** is the text fed back to the model — what it sees as the tool's
  output.
- **`summary`** is a one-line status for the console and logs (e.g. `"weather · Paris"`).
- **`media`** is a list of attachments to show directly to the model; use `[]`
  for an ordinary text result.

**Bound large output.** Context is finite, so don't feed the model a megabyte.
`elide(text, maxChars)` trims to a head-plus-tail excerpt with the middle marked.
The rule is **reference, don't inline**: return a bounded excerpt to the model and
log the full artifact, so nothing is lost (this is what `runCode` does — the elided
result to the model and the whole output to the session's structured log. See
[logging.md](/concepts/logging/)).

```jo
new RunOutcome(elide(output, 4000), "ran · 3.1s", [])
```

## Tools that own their logic

Most of an agent's logic ends up inside its tools, and a tool grows: helper
functions, a resource it holds open, state it keeps between calls. Implement
`Tool` directly and all of that lives in one class, instead of in
namespace-level functions threading captured values through a closure.

```jo
class WeatherTool(apiKey: String)
  view Tool

  private var lookups: Int = 0

  def name: String = "weather"
  def description: String = "Look up the current weather in a city"
  def params: List[ToolParam] = [strParam("city", "the city to look up")]

  def run(input: ToolInput): RunOutcome =
    lookups = lookups + 1
    report(input.string("city"))

  private def report(city: String): RunOutcome =
    new RunOutcome("Sunny in \{city}, 22°C", "weather · \{city}", [])
end
```

Two things to know:

- `run` does not restate `receives`. It inherits the interface's declaration, so
  the handler reads the ambient `logger` and `callContext` exactly as a
  factory-built tool does — the current turn's, not the ones in scope when the
  tool was constructed.
- A class parameter does not implement an interface member, so name the
  parameters apart from `name` / `description` / `params` and let the members
  read them.

Because `description` and `params` are methods, a tool written this way can also
compute its schema per turn rather than freezing it at construction.

## Errors are safe

You don't have to catch everything. The engine runs every tool through a backstop
(`runSafely`), so if your handler throws — or `abort`s — the exception becomes an
*error* `RunOutcome` fed back to the model. The turn continues and the driver never
crashes. Return a clear message for expected failures. Let unexpected ones raise.

## Adding your tool

Tools are assembled per session where your driver constructs its `Agent` — append
yours to the defaults:

```jo
Defaults.tools(610.0) ++ memoryTools(memory) ++ [weatherTool()]
```

That is the whole wiring: the model now sees `weather` in its toolset and can call
it. (An agent with different needs can build the toolset from scratch instead of
starting from `Defaults.tools(610.0)`.)

## Logging from a tool

Inside a handler `logger` is in scope, so a tool can record what it did under its
own category:

```jo
private def lookUp(city: String): RunOutcome receives logger =
  logger.info("myagent.tools.weather", "looked up weather", "city" ~ city)
  new RunOutcome("Sunny in \{city}, 22°C", "weather · \{city}", [])
```

The event is stamped with the session automatically — ready for auditing or usage
reports. See [logging.md](/concepts/logging/).
