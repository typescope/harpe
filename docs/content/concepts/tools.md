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

A tool is two things, and Harpe keeps them apart because they live in different
time.

A **spec** is timeless. *`weather` takes a city and returns its weather* is true
on the first turn and the thousandth, in every session, for every user. It does
not depend on who is asking, what was said before, or where this user's files
are. It is also what each provider re-renders into wire format on every single
request.

An **executor** is contextual. It runs *now*: for this turn, in this session,
against this user's data directory, through this interaction channel, with this
request's credentials. Almost nothing about it is stable.

Bundle the two and one of them has to give. Either the timeless half is rebuilt
whenever the context changes — a fresh toolset per session, per turn — or the
contextual values must reach the object some other way, because an object built
at startup cannot know where this turn's files live.

Keeping them apart costs one map. The spec is what the model is offered:

```jo
interface Tool
  def name: String
  def description: String
  def params: List[ToolParam]
end
```

- **`name`** — how the model calls it.
- **`description`** — prose the model reads to decide *when* to call it. Write it
  for the model, not for yourself.
- **`params`** — the typed inputs it accepts (below). Read every time a request is
  rendered, so a tool may derive its schema from live state.

The **handler** is the executor — what actually runs — and is wired per turn:

```jo
type Handler = ToolInput => RunOutcome receives logger, interact
```

Your driver hands `runTurn` a `Map[String, Handler]` pairing each spec's name with
the code to run. Because you write that map, a handler closes over whatever the
turn needs — a session's data directory, an API token, your own typed context —
with nothing passed through the framework to get there. Every spec must have a
route: an unrouted name aborts the turn before the model is called.

You describe the spec in Jo. Each provider renders its own wire spec from it, so
you never hand-write JSON schema.

See [Structured output](/concepts/structured-output/) for why Harpe usually keeps
machine-consumed data in the typed Jo program instead of formatting it as the
agent's final answer.

## What ships

The framework provides the tools, and your driver wires them:

- **`runCodeTool(sandboxDir, approvalDeadline)`** — `runCode`, which compiles and
  runs a Jo program in the sandbox. This is the agent's main way to act.
- **`UploadMediaTool`** — `uploadMedia`, which shows an image or PDF from the
  data directory directly to the chat model.
- **`SkillTools`** — `skillsList` / `skillsRead` / `skillsSearch`, read-only
  access to the agent's `skills/`.
- **`MemoryTools`** — `updateMemory` / `readMemory` / `listMemory`, the agent's
  working memory.

Each offers `spec` (or `specs`, for a group) plus one typed method per verb that
your routes call. Only `runCodeTool` is a constructor: it is the one tool that
owns something with a lifetime — the semaphore bounding concurrent sandbox runs
— while the others own nothing, so they are sections and their per-session
values arrive as arguments.

There is deliberately no default toolset: a driver names what its agent can do,
so the whole surface is readable in one place.

## Writing a tool

Declare the spec, then route its name to code that returns a `RunOutcome`:

```jo
import harpe.Tool
import harpe.Tool.*

val weather: Tool =
  Tool:
    name = "weather"
    description = "Look up the current weather in a city"
    params = [strParam("city", "the city to look up")]

// In the driver's handler map. `logger` is in scope inside a route.
weather.name ~ (i => lookUp(i["city"]))

// The route stays one line; the work lives in a function.
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
class RunOutcome(result, summary, attachments)
```

- **`result`** is the text fed back to the model — what it sees as the tool's
  output.
- **`summary`** is a one-line status for the console and logs (e.g. `"weather · Paris"`).
- **`attachments`** is a list of files to show directly to the model; use `[]`
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
`Tool` directly and all of that lives in one class — the spec it offers, the
config it holds, and the typed methods its routes call.

```jo
class WeatherTool(apiKey: String)
  view Tool

  private var lookups: Int = 0

  def name: String = "weather"
  def description: String = "Look up the current weather in a city"
  def params: List[ToolParam] = [strParam("city", "the city to look up")]

  //[ What the route calls. Per-turn values arrive as arguments. //]
  def lookUp(city: String, units: String): RunOutcome =
    lookups = lookups + 1
    report(city, units)

  private def report(city: String, units: String): RunOutcome =
    new RunOutcome("Sunny in \{city}, 22°\{units}", "weather · \{city}", [])
end
```

The object goes in the agent's spec list and its method goes in the handler map:

```jo
weather.name ~ (i => weather.lookUp(i["city"], preferredUnits))
```

Three things to know:

- **A class only if the tool owns something.** An API key, a connection, a
  semaphore — something with a lifetime. Everything contextual is an argument
  its route supplies, which is what lets one object serve every session at once:
  a single `runCode` bounds sandbox concurrency across the whole process, while
  each session's route hands it that session's settings. A tool that owns
  nothing is a `section` instead, with its spec as a constant and every value it
  needs passed in — that is what `SkillTools` and `MemoryTools` are.
- A class parameter does not implement an interface member, so name the
  parameters apart from `name` / `description` / `params` and let the members
  read them.
- Because `description` and `params` are methods, a tool written this way can
  compute its schema from live state rather than freezing it at construction.

## Errors are safe

You don't have to catch everything. The engine runs every tool through a backstop
(`runSafely`), so if your handler throws — or `abort`s — the exception becomes an
*error* `RunOutcome` fed back to the model. The turn continues and the driver never
crashes. Return a clear message for expected failures. Let unexpected ones raise.

## Adding your tool

Wiring happens in two places where your driver constructs its `Agent`. The specs
go on the agent:

```jo
val specs: List[Tool] = [runCode, weather, ..SkillTools.specs, ..MemoryTools.specs]
```

and the routes go to each turn:

```jo
val handlers: Map[String, Handler] = Map:
  runCode.name                ~ (i => runCode.run(i["code"]))
  weather.name                ~ (i => weather.lookUp(i["city"]))
  SkillTools.readSpec.name    ~ (i => SkillTools.read(skillsDir, i["name"]))
  MemoryTools.updateSpec.name ~ (i => MemoryTools.update(memory, i["key"], i["value"]))

agent.runTurn(userMsg, handlers, maxToolRounds = 50, maxRetries = 4)
```

That is the whole wiring: the model now sees `weather` in its toolset, and the map
says exactly what happens when it calls it. The map is also where per-turn and
per-session values enter — the CLI passes its data directory to `uploadMedia`
this way, and the `pr-review` example passes a PR URL and a GitHub token into
`runCode`'s guest environment.

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
