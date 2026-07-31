+++
title = "Models"
+++
The model is the agent's brain. It interprets context, chooses tools, and
produces answers. Harpe exposes models through a provider-independent interface,
so the rest of the agent does not depend on a provider's wire protocol.

Harpe separates a reusable `Model` from a `Turn`. The model starts one user turn
from rendered context. The returned `Turn` carries any provider state needed
across that turn's tool calls. Conversation history across user turns remains in
the agent's [Context](/concepts/context/).

## Model and Turn

```jo
interface Model
  def startTurn(base: Rendered): Turn

interface Turn
  def reply(results: List[ToolResult], tools: List[Tool]): ReplyResult
      receives logger, callContext
```

`startTurn` is called once with the system prompt, conversation history, and
transient context. `reply` is called for each model round. It receives results
from the previous tool calls and the tools available for the next response.

A `Turn` may keep provider-specific state such as reasoning handles or a
server-side response ID. That state lasts only for the current user turn and
does not leak into the provider-independent transcript.

The result of a model round is explicit:

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

Harpe includes Anthropic, OpenAI Responses API, and a keyless `echo` model for
testing. `Defaults.model()` selects and constructs a provider from environment
variables:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Select and authenticate Anthropic |
| `OPENAI_API_KEY` | Select and authenticate OpenAI. Takes precedence when both keys are set |
| `MODEL` | Override the provider's default model ID |
| `REASONING_EFFORT` | Set OpenAI reasoning effort to `low`, `medium`, `high`, or `none` |
| `PROMPT_CACHE` | Set Anthropic prompt caching to `5m`, `1h`, or `off` |
| `OPENAI_BASE_URL` | Use another Responses API endpoint, such as Azure OpenAI or a proxy |

The default model IDs are `claude-opus-4-6` for Anthropic and `gpt-5.6` for
OpenAI. If neither API key is set, startup fails.

```sh
MODEL=claude-opus-4-6
ANTHROPIC_API_KEY=sk-…
```

Third-party chat-completions endpoints are not compatible with the built-in
OpenAI implementation. Provide a custom `Model` for a different protocol.

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
val brain = echo()
```

A model can be shared across sessions. Each call to `startTurn` creates the
state isolated to one user turn.

## Custom models

Implement `Model` for another provider or a locally deployed model. Use
`SimpleTurn` when each round can resend the accumulated conversation without
keeping additional provider state:

```jo
class MyModel(client: Client)
  view Model

  def startTurn(base: Rendered): Turn =
    new SimpleTurn(base, (rendered, tools) => send(client, rendered, tools))
end
```

Implement `Turn` directly when the provider carries state across tool rounds.
The built-in Anthropic and OpenAI implementations do this to preserve
[reasoning](/concepts/reasoning/) state.

A custom implementation must translate Harpe messages and tools to the provider
protocol, classify failures as `Transient` or `Fatal`, and report token usage.
