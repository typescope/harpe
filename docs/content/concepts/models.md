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
        receives logger
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

Harpe includes Anthropic, OpenAI, OpenRouter, OpenAI-compatible servers, and a
keyless `echo` model for testing. `Model.default()` selects and constructs a
hosted provider from environment variables. OpenAI takes precedence, followed
by OpenRouter and Anthropic.

> **Local models:** Call `openai(...)` with `compatible = true` for servers such
> as vLLM, SGLang, llama.cpp, and Ollama.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Select and authenticate Anthropic |
| `OPENAI_API_KEY` | Select and authenticate OpenAI |
| `OPENROUTER_API_KEY` | Select and authenticate OpenRouter |
| `MODEL` | Override the provider's default model ID |
| `OPENAI_BASE_URL` | Use another Responses API endpoint, such as Azure OpenAI or a proxy |

The default model IDs are `claude-opus-4-6` for Anthropic and `gpt-5.6` for
OpenAI. OpenRouter requires an explicit `MODEL`. If no API key is set, startup
fails.

`Model.default()` covers provider selection only. Provider-specific tuning,
such as Anthropic's prompt-cache policy, stays with the provider constructor:
`Model.default()` uses the default 5-minute cache, and an agent needing another
policy calls `anthropic(...)` itself. See
[Prompt Caching](/guides/prompt-caching/).

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

### Local inference servers

Open-weight models can run behind a local inference server. The main choices
serve different deployment scales:

| Server | Best fit | API and agent features |
|---|---|---|
| [vLLM](https://docs.vllm.ai/en/stable/serving/online_serving/) | High-throughput GPU serving, from one GPU to distributed deployments | Chat Completions and Responses APIs, structured output, tool calling, reasoning parsers, prefix caching, speculative decoding, and tensor, pipeline, data, or expert parallelism |
| [SGLang](https://docs.sglang.ai/basic_usage/openai_api_completions.html) | High-throughput GPU serving with aggressive prefix reuse and distributed execution | Chat Completions API, structured output, model-specific tool and reasoning parsers, speculative decoding, and tensor, data, or expert parallelism |
| [llama.cpp](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) | Laptops, workstations, edge devices, and CPU or mixed CPU/GPU inference | Quantized GGUF models, Chat Completions and Responses APIs, tool calling, structured output, speculative decoding, and parallel requests |
| [Ollama](https://docs.ollama.com/api/openai-compatibility) | Simple local installation and model management | Chat Completions and a stateless Responses API with tools and reasoning summaries |

For a GPU service handling concurrent users, start with vLLM or SGLang and
benchmark both on the target model and hardware. Their performance depends on
the model architecture, request lengths, concurrency, quantization, and
parallelism settings. For a developer workstation or CPU-heavy deployment,
llama.cpp is usually the more direct serving layer. Ollama adds convenient
model download and lifecycle management around local inference.

Compatibility mode supports servers that expose an OpenAI-compatible Chat
Completions API. Pass the server's base URL. The adapter keeps accepted messages
and tool results in `Model.Session`:

```jo
val brain = openai:
  ""
  "org/model-name"
  baseUrl = "http://localhost:8000/v1"
  compatible = true
```

The first argument is an API key. Pass an empty string when the server does not
require authentication.

The adapter supports messages, images, function tools, tool results, and token
usage. Within a turn it preserves the provider's complete raw assistant messages,
so extension fields such as `reasoning`, `reasoning_content`, and
`reasoning_details` survive tool calls without entering Harpe's transcript.

The `openai`, `openrouter`, and `anthropic` constructors accept `extraBody` for
provider-specific request fields. Each adapter forwards it through its native
SDK on every request path. For `openai`, this works in both Responses and
compatible Chat Completions modes. For example, NVIDIA Nemotron reasoning can
be configured with:

```jo
val brain = openai:
  nvidiaApiKey
  "nvidia/nemotron-3-ultra-550b-a55b"
  baseUrl = "https://integrate.api.nvidia.com/v1"
  compatible = true
  timeoutSeconds = 120
  extraBody = py.dict:
    "reasoning_effort" ~ "high"
    "reasoning_budget" ~ 16384
    "chat_template_kwargs" ~ py.dict(
      "enable_thinking" ~ true,
      "force_nonempty_content" ~ true
    )
```

## Selecting a model in code

The shipped applications construct the model at startup:

```jo
val brain = Model.default()
```

You can instead construct a provider explicitly or use `echo()` without an API
key:

```jo
val brain = anthropic(apiKey, "claude-opus-4-6", Anthropic.FiveMinutes)
val brain = openai(apiKey, "gpt-5.6", reasoningEffort = "high")
val brain = openrouter(apiKey, "provider/model-name", reasoningEffort = "high")
val brain = openai("", "org/model-name", "http://localhost:8000/v1", compatible = true)
val brain = echo()
```

Model constructors use a 120-second HTTP request timeout by default. Applications
can set `timeoutSeconds` explicitly when they need a different limit.

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
