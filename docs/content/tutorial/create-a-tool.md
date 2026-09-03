+++
title = "Create a Tool"
+++
A tool lets the model call code in your application during a turn. In this
tutorial, you will create a `weather` tool, add it to an agent, and return a
result the model can use in its answer.

This tutorial assumes you already have an agent that calls `Agent.ask`. If you
do not, start with [Build Your First Agent](/tutorial/build-your-first-agent/).
For the ideas behind tool specs, handlers, and toolsets, see
[Tools](/concepts/tools/).

## Define what the model can call

A tool tells the model its name, what it does, and which parameters it accepts.
Create `WeatherTool.jo` in your application's source directory. Use the same
namespace as your driver:

```jo
namespace my.agent

import harpe.Interact
import harpe.Tool
import harpe.Tool.*
import harpe.Toolset

class WeatherTool
  view Tool

  def name: String = "weather"

  def description: String =
    "Look up the current weather in a city"

  def params: List[ToolParam] =
    [strParam("city", "the city to look up")]
end
```

Replace `my.agent` with the namespace used by your application.

The model reads `description` to decide when to call the tool. It uses `params`
to construct the call. Parameter names therefore become part of the contract
between the model and your handler.

Harpe provides four parameter constructors:

```jo
strParam(name, description)    // string
intParam(name, description)    // integer
boolParam(name, description)   // boolean
numParam(name, description)    // number
```

These constructors create required parameters.

## Implement the operation

Add a typed method to `WeatherTool` for the work the tool performs:

```jo
def lookUp(city: String, units: String): ToolOutcome =
  new ToolOutcome:
    "Sunny in \{city}, 22°\{units}"
    "weather · \{city}"
```

This tutorial returns sample weather so the example has no external dependency.
In a real application, this method can call your weather client, database, or other
service.

A `ToolOutcome` has four fields:

```jo
class ToolOutcome(
    result: String,
    summary: String,
    attachments: List[Attachment] = Tool.NoAttachments,
    success: Bool = true)
```

- **`result`** is the text returned to the model.
- **`summary`** is a short status shown by the driver.
- **`attachments`** contains files to send directly to the model. It defaults
  to an empty list.
- **`success`** reports whether the tool completed its task. It defaults to
  `true`.

Most text-only tools only need `result` and `summary`, as the weather example
does.

## Connect the model call to the operation

The tool spec tells the model what it may call. A `Toolset` pairs that spec with
the handler Harpe should run. Add this method inside `WeatherTool`:

```jo
def toolset(units: String): Toolset =
  Toolset.of: this, (input: ToolInput, _: Interact) =>
    lookUp(input["city"], units)
```

The model supplies `city` through `ToolInput`. Your application supplies
`units` when it builds the toolset. This distinction lets the same tool use
application or session settings without exposing them as model-controlled
parameters.

`input["city"]` is the short form of `input.string("city")`. Typed accessors
are available for every parameter type:

```jo
input.string("city")
input.int("count")
input.bool("verbose")
input.num("threshold")
```

If a key is absent, these accessors return the type's zero value. Accessors such
as `input.intOr("count", 10)` let you choose an explicit fallback.

Every handler receives an `Interact` as its second argument. This weather tool
does not need it, so the handler names it `_`. A tool can use it when it needs to
report interaction events or request approval.

## Put it together

The complete `WeatherTool.jo` is:

```jo
namespace my.agent

import harpe.Interact
import harpe.Tool
import harpe.Tool.*
import harpe.Toolset

class WeatherTool
  view Tool

  def name: String = "weather"

  def description: String =
    "Look up the current weather in a city"

  def params: List[ToolParam] =
    [strParam("city", "the city to look up")]

  def lookUp(city: String, units: String): ToolOutcome =
    new ToolOutcome:
      "Sunny in \{city}, 22°\{units}"
      "weather · \{city}"

  def toolset(units: String): Toolset =
    Toolset.of: this, (input: ToolInput, _: Interact) =>
      lookUp(input["city"], units)
end
```

The class keeps the model-facing spec, the handler wiring, and the operation in
one place. If a real weather tool owns an API client or connection, pass it to
the class constructor and use it from `lookUp`.

## Add the tool to your agent

Construct the tool alongside the other long-lived objects in your driver:

```jo
val weather = new WeatherTool
```

Then include its toolset when starting the turn:

```jo
val tools =
  SkillTools.toolset(skillsDir)
    ++ runCode.toolset()
    ++ weather.toolset("C")

val turn =
  Agent.ask:
    message
    brain = brain
    tools = tools
    context = context
```

The model can now call `weather` with a `city`. Harpe finds the matching handler,
runs `lookUp`, and returns its `ToolOutcome.result` to the model. The model can
then use that weather in its final answer.

You do not need the other toolsets in this example. Keep only the tools your
agent should be able to call.

## Report expected failures

When the request is valid but the operation cannot complete, return a helpful
result and set `success = false`:

```jo
new ToolOutcome:
  "Weather is not available for '\{city}'. Ask for another city."
  "weather unavailable · \{city}"
  success = false
```

The model reads the result and can correct its request. Application code can use
`success` to distinguish completed calls from refusals.

You do not need to catch every unexpected exception. Harpe runs handlers through
`runSafely`. If a handler throws or calls `abort`, Harpe converts the exception
to a failed `ToolOutcome` and lets the turn continue.

## Log from the tool

Import `harpe.logging.logger`, then add `receives logger` when the operation
should write structured logs:

```jo
def lookUp(city: String, units: String): ToolOutcome receives logger =
  logger.info("myagent.tools.weather", "looked up weather", "city" ~ city)
  new ToolOutcome:
    "Sunny in \{city}, 22°\{units}"
    "weather · \{city}"
```

Harpe associates the event with the current session. See
[Logging](/concepts/logging/) for categories, structured fields, and reports.
