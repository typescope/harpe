+++
title = "Create a Tool"
+++
A custom tool lets the model call application code during a turn. This tutorial
builds a weather tool, defines its input, and returns a result the model can use.

For the relationship between tool specs, handlers, and toolsets, first read the
[Tools concept page](/concepts/tools/).

## Declare and handle a tool

Declare the spec, then route its name to code that returns a `ToolOutcome`:

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

// The route stays one line. The work lives in a function.
// Once a tool grows past that, give it a class instead.
private def lookUp(city: String): ToolOutcome =
  new ToolOutcome("Sunny in \{city}, 22°C", "weather · \{city}")
```

## Parameters

Each parameter has a name, a type, and a description the model reads. Four
constructors cover the schema types. All of them produce a required parameter:

```jo
strParam(name, description)    // string
intParam(name, description)    // integer
boolParam(name, description)   // boolean
numParam(name, description)    // number (float)
```

Read them from the call's `input` with typed accessors. A missing key yields a
zero value. Use the `…Or` variant for an explicit fallback:

```jo
input.string("city")           // "" if absent
input.int("count")             // 0 if absent
input.bool("verbose")          // false if absent
input.num("threshold")         // 0.0 if absent
input.intOr("count", 10)       // 10 if absent
input["city"]                  // the indexing form of `string`
```

## Return a result

A handler returns a `ToolOutcome`:

```jo
class ToolOutcome(
    result: String,
    summary: String,
    attachments: List[Attachment] = Tool.NoAttachments,
    success: Bool = true)
```

- **`result`** is the text returned to the model.
- **`summary`** is a one-line status for the console and logs.
- **`attachments`** contains files to show directly to the model. It defaults
  to an empty list.
- **`success`** reports whether the call completed its task. It defaults to
  `true`.

For an expected refusal, explain the problem in `result` and set
`success = false`. The model can then correct its request:

```jo
new ToolOutcome:
  "No such file: '\{fileName}'. Write it to your data directory first, then send it."
  "sendFile · no such file"
  success = false
```

Keep large results out of the model context. `elide(text, maxChars)` returns a
head-and-tail excerpt with the omitted middle marked:

```jo
new ToolOutcome(elide(output, 4000), "ran · 3.1s")
```

Log or store the complete artifact when the model may need to refer to it later.
See [Logging](/concepts/logging/).

## Put it together

Use a class when the tool owns a resource or state with a lifetime, such as an
API key, connection, or concurrency limit. The class keeps its spec, routing,
and implementation together:

```jo
class WeatherTool(apiKey: String)
  view Tool

  private var lookups: Int = 0

  def name: String = "weather"
  def description: String = "Look up the current weather in a city"
  def params: List[ToolParam] = [strParam("city", "the city to look up")]

  def lookUp(city: String, units: String): ToolOutcome =
    lookups = lookups + 1
    report(city, units)

  def toolset(units: String): Toolset =
    Toolset.of: this, (i: ToolInput) => lookUp(i["city"], units)

  private def report(city: String, units: String): ToolOutcome =
    new ToolOutcome("Sunny in \{city}, 22°\{units}", "weather · \{city}")
end
```

The `toolset` method pairs the object with its handler. It also supplies
contextual values such as the preferred units for this session.

A tool that owns nothing can remain a `section` or a simple value. Pass
per-session and per-turn values through its `toolset` method rather than storing
them globally.

A class parameter does not implement an interface member. Give constructor
parameters names distinct from `name`, `description`, and `params`, then expose
those interface members explicitly.

## Handle errors

You do not need to catch unexpected failures inside every handler. Harpe runs
tools through `runSafely`. If a handler throws or calls `abort`, Harpe converts
the exception to a failed `ToolOutcome` and returns it to the model. The turn can
then continue.

Return a clear failed outcome for an expected problem. Let unexpected failures
raise so the backstop can report them.

## Add the tool to your agent

Combine the weather toolset with the other tools when the driver starts a turn:

```jo
val tools =
    ++ SkillTools.toolset(skillsDir)
    ++ runCode.toolset()
    ++ weather.toolset(preferredUnits)

Agent.ask(text, brain = brain, tools = tools, context = context)
```

The model now sees `weather` and its parameters. The same toolset entry tells
Harpe which handler to run when the model calls it.

The toolset is also where per-turn and per-session values enter. In this example,
the driver supplies `preferredUnits`. A one-off tool can use `.add: spec, handler`
directly, but a named tool is usually clearer when it provides its own `toolset`
method.

## Log from the tool

Inside a handler, `logger` is in scope. Use it to record what the tool did:

```jo
private def lookUp(city: String): ToolOutcome receives logger =
  logger.info("myagent.tools.weather", "looked up weather", "city" ~ city)
  new ToolOutcome("Sunny in \{city}, 22°C", "weather · \{city}")
```

Harpe adds the session to the event automatically. See
[Logging](/concepts/logging/) for categories, structured fields, and reports.
