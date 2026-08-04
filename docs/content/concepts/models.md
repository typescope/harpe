+++
title = "Models"
+++
The model is the agent's brain. It interprets context, chooses tools, and
produces answers. Harpe exposes models through a provider-independent interface,
so the rest of the agent does not depend on a provider's wire protocol.

Harpe separates a reusable `Model` from the model-side state of an active user
turn. `startTurn` creates that state from rendered context and returns it as a
`Model.Session`. The object exists only to continue model requests across tool
calls. It does not run the turn, own the conversation, or persist its history.
The agent runs the turn. Conversation history across turns remains in its
[Context](/concepts/context/).

## Model and per-turn state

```jo
interface Model
  def startTurn(base: Rendered): Model.Session

section Model
  interface Session
    def reply(results: List[ToolResult], tools: List[Tool]): ReplyResult
        receives logger, callContext
  end
end
```

Here, a **user turn** means the complete exchange from one user message to the
agent's final answer, including any tool calls. `Model.Session` is the model
adapter's state during that exchange, not an application or conversation
session. It may make several model API calls while the agent uses tools.

`startTurn` is called once with the system prompt, conversation history, and
transient context. The agent calls `reply` again whenever it has tool results to
return to the model. Each call receives those results and the tools available
for the next response.

A `Model.Session` may keep provider-specific continuation state such as reasoning
handles or a server-side response ID. That state lasts only for the current
user turn and does not leak into the provider-independent transcript.

The result of each `reply` call is explicit:

```jo
union ReplyResult =
    Reply(message: Assistant, usage: Usage)
  | Transient(detail: String)
  | Fatal(detail: String)
```

The model classifies failures. The core decides whether and when to retry them.
`reply` is idempotent, so a failed attempt does not commit tool results or mutate
the turn.

Each successful reply includes provider-reported input and output token counts.
Harpe emits them through the [Logger](/concepts/logging/) and makes the usage
available to context strategies.

## Built-in models

Harpe includes Anthropic, OpenAI, OpenRouter, and a keyless `echo` model for
testing. `Defaults.model()` selects and constructs a provider from environment
variables. OpenAI takes precedence, followed by OpenRouter and Anthropic.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Select and authenticate Anthropic |
| `OPENAI_API_KEY` | Select and authenticate OpenAI |
| `OPENROUTER_API_KEY` | Select and authenticate OpenRouter |
| `MODEL` | Override the provider's default model ID |
| `REASONING_EFFORT` | Set OpenAI or OpenRouter reasoning effort to `low`, `medium`, `high`, or `none` |
| `PROMPT_CACHE` | Set Anthropic prompt caching to `5m`, `1h`, or `off` |
| `OPENAI_BASE_URL` | Use another Responses API endpoint, such as Azure OpenAI or a proxy |

The default model IDs are `claude-opus-4-6` for Anthropic and `gpt-5.6` for
OpenAI. OpenRouter requires an explicit `MODEL`. If no API key is set, startup
fails.

```sh
MODEL=claude-opus-4-6
ANTHROPIC_API_KEY=sk-…
```

### Open-weight models

OpenRouter gives Harpe access to open-weight models from multiple providers. Set
one OpenRouter API key and choose a model from its
[model catalog](https://openrouter.ai/models):

```sh
OPENROUTER_API_KEY=sk-or-…
MODEL=provider/model-name
```

The OpenRouter adapter uses its stateless Responses API. It preserves raw
reasoning and tool-call items locally, then resends the complete turn whenever
it returns tool results to the model.

Harpe can also use a locally deployed open-weight model through a custom `Model`
adapter. The adapter can target llama.cpp, vLLM, Ollama, or another inference
server without changing the agent core.

Do not assume that an OpenAI-compatible endpoint works with Harpe's built-in
OpenAI adapter. It relies on Responses API tool calls, token usage, and
stateful continuation through `previous_response_id`. Some servers implement
only part of that contract.

## Selecting a model in code

The shipped applications construct the model at startup:

```jo
val brain = Defaults.model()
```

You can instead construct a provider explicitly or use `echo()` without an API
key:

```jo
val brain = anthropic(apiKey, "claude-opus-4-6", FiveMinutes)
val brain = openai(apiKey, "gpt-5.6", "")
val brain = openrouter(apiKey, "provider/model-name")
val brain = echo()
```

A model can be shared across sessions. Each call to `startTurn` creates the
state isolated to one user turn.

## Custom models

Implement `Model` for another provider or a locally deployed model. Use
`SimpleSession` when each `reply` call can resend the accumulated conversation
without keeping additional provider state:

```jo
class MyModel(client: Client)
  view Model

  def startTurn(base: Rendered): Model.Session =
    new SimpleSession(base, (rendered, tools) => send(client, rendered, tools))
end
```

Implement `Model.Session` directly when the provider carries state between
`reply` calls. The built-in Anthropic and OpenAI implementations do this to
preserve [reasoning](/concepts/reasoning/) state.

A custom implementation must translate Harpe messages and tools to the provider
protocol, classify failures as `Transient` or `Fatal`, and report token usage.
