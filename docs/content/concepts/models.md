+++
title = "Models"
+++
The model is the agent's brain. It interprets context, chooses tools, and
produces answers. Harpe exposes models through a provider-independent interface,
so the rest of the agent does not depend on a provider's wire protocol.

## Choosing a model

Most applications can start with `Model.default()`. It selects OpenAI,
OpenRouter, or Anthropic from the API key present in the environment:

```jo
val brain = Model.default()
```

Construct a provider explicitly when you need to choose its model or options:

```jo
val brain = anthropic(apiKey, "claude-opus-4-6", Anthropic.FiveMinutes)
val brain = openai(apiKey, "gpt-5.6", reasoningEffort = "high")
val brain = openrouter(apiKey, "provider/model-name")
val brain = openai.compatible("", "org/model-name", "http://localhost:8000/v1")
val brain = echo() // keyless model for tests
```

Pass the selected model to `Agent.ask` as `brain`. A `Model` can be shared by
many conversations. Harpe creates isolated state for each active turn.

## Providers and deployment

Harpe includes Anthropic, OpenAI, OpenRouter, OpenAI-compatible servers, and a
keyless `echo` model for testing. `Model.default()` selects and constructs a
hosted provider from environment variables. OpenAI takes precedence, followed
by OpenRouter and Anthropic.

> **Local models:** Call `openai.compatible(...)` for servers such
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
val brain = openai.compatible:
  ""
  "org/model-name"
  baseUrl = "http://localhost:8000/v1"
```

The first argument is an API key. Pass an empty string when the server does not
require authentication.

The adapter supports messages, images, function tools, tool results, and token
usage. Within a turn it preserves the provider's complete raw assistant messages,
so extension fields such as `reasoning`, `reasoning_content`, and
`reasoning_details` survive tool calls without entering Harpe's transcript.

The `openai`, `openai.compatible`, `openrouter`, and `anthropic` constructors
accept `extraBody` for provider-specific request fields. Each adapter forwards
it through its native SDK on every request path. For example, NVIDIA Nemotron
reasoning can be configured with:

```jo
val brain = openai.compatible:
  nvidiaApiKey
  "nvidia/nemotron-3-ultra-550b-a55b"
  baseUrl = "https://integrate.api.nvidia.com/v1"
  timeoutSeconds = 120
  extraBody = py.dict:
    "reasoning_effort" ~ "high"
    "reasoning_budget" ~ 16384
    "chat_template_kwargs" ~ py.dict(
      "enable_thinking" ~ true,
      "force_nonempty_content" ~ true
    )
```

## Request and turn options

The OpenAI Responses adapter uses stored server-side continuation by default.
Pass `store = false` to keep the active turn stateless. Harpe then replays the
raw response items required by later tool rounds instead of sending a
`previous_response_id`.

Model constructors use a 120-second HTTP request timeout by default. Applications
can set `timeoutSeconds` explicitly when they need a different limit.

How much a reply may contain is a property of the turn, not of the model. It is
`Agent.ask`'s `maxOutputTokens`, 8192 by default, alongside the other two
budgets a turn is given:

```jo
val turn = Agent.ask:
  question
  brain = brain
  maxToolRounds = 50
  maxOutputTokens = 32000
```

The engine passes it to `Model.startTurn`, and it is fixed for the turn — every
round of the tool loop is sent with the same bound, so a turn cannot be talked
into a larger reply as it goes. A reply that reaches the limit comes back with a
note saying it was truncated rather than as an error, so the model can be asked
to continue.

The same agent can therefore answer briefly on one turn and write a long report
on the next without holding two models. A custom `Model` renders the bound as
whatever its provider calls the limit, and one with no such notion ignores it.

A model can be shared across sessions. Harpe creates isolated state for each
active turn.

## How Harpe represents a model

The rest of this page matters when you implement a provider adapter. Harpe
separates a reusable `Model` from the model-side state of an active user turn:

```jo
interface Model
  def startTurn(base: Rendered, maxOutputTokens: Int): Model.Session

section Model
  interface Session
    def reply(results: List[ToolResult], tools: List[Tool], interact: Interact): ReplyResult
        receives logger
  end
end
```

`startTurn` creates a `Model.Session` from the prepared context. The session
continues model requests across tool calls. It may keep provider-specific state
such as reasoning handles or a server-side response ID. That state lasts only
for the current turn. `session.model` points back to the model that created it,
which lets the turn engine attribute every request without provider-specific
logging.

`interact` carries streamed text and cancellation. See [Turn](/concepts/turn/)
for the event contract and streaming behavior.

The result of each `reply` call is explicit:

```jo
union ReplyResult =
    Reply(message: Assistant, usage: Usage)
  | Transient(detail: String)
  | RetryAfter(detail: String, retryAfterSeconds: Float)
  | Fatal(detail: String)
```

The adapter classifies failures and reports token usage. Relevant transport
details, such as an HTTP status, belong in `detail`. The turn engine owns logging
and retry policy. `Session.reply` deliberately receives no logger. A failed
request does not commit pending tool results or mutate the accepted turn state.

`harpe.metering.Usage` is the metered record of one call, and carries everything
a charge is computed from — the `provider` and `model` that were asked,
`inputTokens` and `outputTokens`, and the `cacheReadTokens`/`cacheWriteTokens`
that break the input total down. The turn engine writes the same value to the log
as `harpe.metering.usage` — its own event, beside the `harpe.model.replied` that
says the attempt succeeded — and `Usage.decode` reads it back, so a bill drawn
from a journal months later is the value the loop saw. A `Context` sizing itself
reads `inputTokens` and ignores the rest: caching changes what a prefix costs,
never what it contains. See
[Billing](/concepts/logging/#building-usage-billing-and-stats).

## Custom models

Implement `Model` for another provider or a locally deployed model. Use
`SimpleSession` when each `reply` call can resend the accumulated conversation
without keeping additional provider state:

```jo
class MyModel(client: Client)
  view Model

  def name: String = "my-model"
  def provider: String = "my-provider"

  def startTurn(base: Rendered, maxOutputTokens: Int): Model.Session =
    new SimpleSession:
      this
      base
      (rendered, tools, interact) =>
        send(client, rendered, tools, interact, maxOutputTokens)
end
```

Implement `Model.Session` directly when the provider carries state between
`reply` calls. The built-in Anthropic and OpenAI implementations do this to
preserve [reasoning](/concepts/reasoning/) state.

A custom implementation must identify its model and provider, translate Harpe
messages and tools to the provider protocol, classify failures as `Transient`
or `Fatal`, and return token usage. The turn engine logs each request, reply,
failure, and usage uniformly.
