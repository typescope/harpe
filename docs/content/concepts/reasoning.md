+++
title = "Reasoning"
+++
Reasoning lets a model spend time working through a request before it answers or
chooses a tool. In an agent, that work may span several tool calls: the model
decides what it needs, reads each result, and continues toward the final answer.

Harpe handles that continuity for you. Choose a reasoning-capable model and the
agent can move through its tool loop without application code managing provider
response IDs, thinking blocks, or other reasoning metadata.

## The tool-loop boundary

Pure reasoning does not require a client-side loop. In one model request, the
provider reasons and then returns final assistant text. The client participates
only when the model requests an external action:

![A request enters provider reasoning. It can produce final text directly or pause at a tool call while the client runs the tool and returns its result for further reasoning.](/img/reasoning-tool-loop.svg)

When a tool is involved, Harpe preserves the model's reasoning context until the
turn completes. A provider may require an opaque response ID, signed thinking
blocks, reasoning items, or extension fields from its previous assistant
message. Harpe keeps that wire state inside the turn's `Model.Session` and sends
it back with the tool result.

## What the built-in adapters preserve

| Adapter | Continuation strategy |
|---|---|
| OpenAI Responses | Keeps the successful response ID and sends it as `previous_response_id` with later tool results |
| OpenRouter Responses | Keeps every raw output item and replays the complete turn because requests use `store = false` |
| OpenAI-compatible Chat Completions | Keeps the complete raw assistant message, including fields such as `reasoning`, `reasoning_content`, and `reasoning_details` |
| Anthropic Messages | Keeps and replays the raw assistant content blocks, including thinking blocks and their signatures |

Only visible text and function calls are translated into Harpe's `Assistant`.
The opaque state lives only until that user turn finishes.

## Configuration

Construct a provider explicitly when the agent needs a particular reasoning
effort:

```jo
val brain = openai(apiKey, "gpt-5.6", reasoningEffort = "high")
val brain = openrouter(apiKey, "provider/model", reasoningEffort = "low")
```

OpenAI and OpenRouter accept these common values:

| Value | Meaning |
|---|---|
| `none` | Omit the Responses API reasoning option |
| `low` | Prefer lower latency and reasoning cost |
| `medium` | Balanced reasoning, and the OpenAI default |
| `high` | Spend more reasoning tokens on difficult work |
| Other values | Passed through as written, if the selected provider and model support them |

OpenAI defaults to `medium`. OpenRouter defaults to `none` because its catalog
contains models with different reasoning capabilities. Anthropic uses adaptive
thinking, so constructing it explicitly does not require an effort value:

```jo
val brain = anthropic(apiKey, "claude-opus-4-6", FiveMinutes)
```

The `openai`, `openrouter`, and `anthropic` constructors accept `extraBody` for
provider-specific controls that are not part of Harpe's small common interface:

```jo
val brain = openai:
  apiKey
  "provider/model"
  baseUrl = "https://provider.example/v1"
  compatible = true
  extraBody = py.dict(
    "reasoning_effort" ~ "high",
    "reasoning_budget" ~ 16384
  )
```

Use only fields supported by the selected server and model. An unsupported
reasoning option is normally a fatal provider request error, not something Harpe
can infer or correct.

## Cost and limits

Reasoning consumes time and output tokens even when it is not visible. More
reasoning can therefore increase latency and cost, and can leave less output
budget for the final answer or tool call. Tune effort against representative
agent tasks rather than assuming the highest setting is always best.
