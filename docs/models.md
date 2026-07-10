# Models

A model is the agent's brain — the LLM the turn loop asks for each reply. It is a
thin, provider-agnostic interface: given the prompt, the conversation so far, and
the offered tools, it returns the assistant's next message (or a typed error). It
is **stateless** — the loop keeps the history; the model just turns one request
into one reply. That's why Anthropic, OpenAI-compatible endpoints, and a keyless
dummy all sit behind the same `Model`.

## Configuring the built-in model

The usual case needs no code — the shipped model is selected by environment
variables (put them in your agent's `.env`):

- **`PROVIDER`** — `anthropic` (default) or `openai`.
- **`MODEL`** — the model id. Defaults to `claude-opus-4-6` (Anthropic) or `gpt-4o`
  (OpenAI).
- **`ANTHROPIC_API_KEY`** / **`OPENAI_API_KEY`** — the key for the chosen provider.
  Missing it fails fast at startup with a clear message.
- **`OPENAI_BASE_URL`** — optional. Point OpenAI at any OpenAI-compatible endpoint
  (Groq, Together, a local llama.cpp, …); leave unset for the real OpenAI API.
- **`PROMPT_CACHE`** — Anthropic prompt caching: `5m` (default), `1h`, or `off`.
  (OpenAI caches long prefixes on its own; this is ignored there.)

So a `.env` of

```sh
PROVIDER=anthropic
MODEL=claude-opus-4-6
ANTHROPIC_API_KEY=sk-…
```

is a complete model configuration.

## Overriding it in code

The model is chosen once, at startup, in your `Config.jo`:

```jo
def model(): Model receives IO.stdout = Defaults.model()   // env-selected (above)
```

Replace the body with any `Model`. Build one explicitly, or use the keyless
`echo()` to exercise the loop without an API key:

```jo
import harpe.models.echo
import harpe.models.anthropic
import harpe.models.FiveMinutes

def model(): Model receives IO.stdout = echo()

// or a fixed provider/model, bypassing the env selection:
def model(): Model receives IO.stdout =
  anthropic(getenv("ANTHROPIC_API_KEY", ""), "claude-opus-4-6", FiveMinutes)
```

The builders are `anthropic(apiKey, model, cache)`, `openai(apiKey, model, baseUrl)`
(pass `""` for the default endpoint), and `echo()`. `model()` is `receives
IO.stdout` because it may print and exit on a missing key — that check belongs at
startup, not inside a request.

## The reply contract

```jo
interface Model
  def reply(rendered: Rendered, tools: List[Tool]): ReplyResult receives logger
end
```

- **In:** a `Rendered` (`system` prompt, the transcript `messages`, and a
  `transient` tail — composed by the [Context](context.md)) plus the tools on
  offer this step.
- **Out:** a `ReplyResult` —

  ```jo
  union ReplyResult =
      Reply(message: Assistant, usage: Usage)   // the next message + token counts
    | Transient(detail: String)                 // retryable: rate limit, 5xx, blip
    | Fatal(detail: String)                      // not retryable: auth, bad request
  ```

The model **classifies** a failure; the loop owns the **policy**: `Transient` is
retried with exponential backoff (up to the configured limit), `Fatal` gives up the
turn. A model never retries internally.

`Usage(inputTokens, outputTokens)` rides on every `Reply`. The loop logs it as the
`harpe.model` event (see [logging](logging.md)) and feeds `inputTokens` to the
Context, so a token-budget strategy sizes on the provider's exact count.

## Writing your own model

Implement the one method — convert the request to your provider's wire format, call
it, and convert back:

```jo
class MyModel(client: py.Dynamic, model: String)
  view Model

  def reply(rendered: Rendered, tools: List[Tool]): ReplyResult receives logger =
    match py.try(callProvider(client, rendered, tools))
    case Ok(response) =>
      val u = response.usage
      Reply(parse(response), new Usage(u.input.asInt, u.output.asInt))
    case Err(err) =>
      classify(err)   // → Transient or Fatal
end
```

Four things to get right:

- **Classify failures** into `Transient` (worth a retry) vs `Fatal` (not), and let
  the engine handle backoff — don't retry inside `reply`.
- **Report usage** in the returned `Usage`; call `logUsage(provider, model, in, out)`
  if you want the `harpe.model` log event too.
- **Stay stateless** — read the whole conversation from `rendered.messages`; keep no
  history of your own.
- **Read `logger` live** — `reply` is `receives logger` (not captured at
  construction), so its logs land in the current turn's context. That's automatic
  as long as you don't hoist the logging out of `reply`.

`Echo.jo` is the minimal reference; `Anthropic.jo` and `OpenAI.jo` are the full
provider implementations to copy from.
