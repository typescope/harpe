+++
title = "Models"
weight = 2
+++
A model is the agent's brain — the LLM that drives each user turn. It is a thin,
provider-agnostic interface: given the composed prompt and the tools on offer, it
produces the assistant's next message (or a typed error), round after round, until
the turn is done. The loop owns the conversation history across turns; a model only
drives **one turn at a time**. That's why Anthropic, OpenAI, and a keyless dummy all
sit behind the same `Model`.

## Configuring the built-in model

The usual case needs no code — the shipped model is selected by environment
variables (put them in your agent's `.env`):

- **`ANTHROPIC_API_KEY`** / **`OPENAI_API_KEY`** — sets *and* selects the provider:
  `OPENAI_API_KEY` selects OpenAI, otherwise `ANTHROPIC_API_KEY` selects Anthropic
  (OpenAI wins if both are set). Setting neither fails fast at startup.
- **`MODEL`** — the model id. Defaults to `claude-opus-4-6` (Anthropic) or `gpt-5.6`
  (OpenAI).
- **`OPENAI_BASE_URL`** — optional. OpenAI uses the Responses API; set this only to
  reach another Responses-API endpoint (Azure OpenAI, a proxy). Third-party
  chat/completions endpoints (Groq, Together, llama.cpp) are not supported.
- **`REASONING_EFFORT`** — reasoning effort: `medium` (default), `low`, `high`, or
  `none` to disable reasoning (needed for a non-reasoning model like `gpt-4o`).
- **`PROMPT_CACHE`** — Anthropic prompt caching: `5m` (default), `1h`, or `off`.
  (OpenAI caches long prefixes on its own; this is ignored there.)

So a `.env` of

```sh
MODEL=claude-opus-4-6
ANTHROPIC_API_KEY=sk-…
```

is a complete model configuration.

## Overriding it in code

The model is chosen once, at startup, in your driver:

```jo
val brain = Defaults.model()   // env-selected (above)
```

Replace that with any `Model`. Build one explicitly, or use the keyless
`echo()` to exercise the loop without an API key:

```jo
import harpe.models.echo
import harpe.models.anthropic
import harpe.models.FiveMinutes

val brain = echo()

// or a fixed provider/model, bypassing the env selection:
val brain = anthropic(getenv("ANTHROPIC_API_KEY", ""), "claude-opus-4-6", FiveMinutes)
```

The builders are `anthropic(apiKey, model, cache)`, `openai(apiKey, model, baseUrl)`
(pass `""` for the default endpoint), and `echo()`. `Defaults.model()` is
`receives IO.stdout` because it may print and exit on a missing key — that check
belongs at startup, not inside a request.

## The turn contract

A model drives one turn in two steps: the loop composes the request once with
`startTurn`, then asks the returned `Turn` for a reply each round.

```jo
interface Model
  def startTurn(base: Rendered): Turn

interface Turn
  def reply(results: List[ToolResult], tools: List[Tool]): ReplyResult receives logger
```

- **`startTurn(base)`** — called once, at the turn's start. `base` is a `Rendered`
  (`system` prompt, the transcript `messages`, and a `transient` tail — composed by
  the [Context](@/concepts/context.md)). The returned `Turn` drives this turn.
- **`reply(results, tools)`** — called once per model round: first with no tool
  results, then with the results of the tools the previous reply requested, plus the
  tools on offer this round. It returns a `ReplyResult`:

  ```jo
  union ReplyResult =
      Reply(message: Assistant, usage: Usage)   // the next message + token counts
    | Transient(detail: String)                 // retryable: rate limit, 5xx, blip
    | Fatal(detail: String)                      // not retryable: auth, bad request
  ```

`reply` is **idempotent**: results are committed only on a successful `Reply`, so
the loop safely retries a failed round without duplicating them. The model
**classifies** a failure; the loop owns the **policy** — `Transient` is retried with
exponential backoff (up to the configured limit), `Fatal` gives up the turn. A model
never retries internally.

`Usage(inputTokens, outputTokens)` rides on every `Reply`. The loop logs it as the
`harpe.model` event (see [logging](@/concepts/logging.md)) and feeds `inputTokens` to the
Context, so a token-budget strategy sizes on the provider's exact count.

## Writing your own model

Most providers have no state to carry between rounds — they just re-send the
conversation each time. For those, return the built-in **`SimpleTurn`** from
`startTurn` and give it a `send` function that converts one request to your wire
format, calls the API, and converts the reply back:

```jo
class MyModel(client: py.Dynamic, model: String)
  view Model

  def startTurn(base: Rendered): Turn =
    new SimpleTurn(base, (rendered, tools) => send(client, model, rendered, tools))

private def send(
    client: py.Dynamic, model: String, rendered: Rendered, tools: List[Tool])
: ReplyResult receives logger =
  match py.try(callProvider(client, rendered, tools))
  case Ok(response) =>
    val u = response.usage
    Reply(parse(response), new Usage(u.input.asInt, u.output.asInt))
  case Err(err) =>
    classify(err)   // → Transient or Fatal
```

`SimpleTurn` accumulates the turn's tool results and re-sends the whole conversation
each round, so `send` only ever handles a single request. If your provider must
carry state across a turn's rounds — most commonly a **reasoning** model keeping its
chain of thought through the tool loop (see [Reasoning](@/concepts/reasoning.md)) —
implement `Turn` directly instead and hold that state in the `Turn` object.

Things to get right:

- **Classify failures** into `Transient` (worth a retry) vs `Fatal` (not), and let
  the engine handle backoff — don't retry inside the model.
- **Report usage** in the returned `Usage`; call `logUsage(provider, model, in, out)`
  if you want the `harpe.model` log event too.
- **Read `logger` live** — `reply` is `receives logger` (not captured at
  construction), so its logs land in the current turn's context.

`Echo.jo` is the minimal reference (a `SimpleTurn`); `Anthropic.jo` and `OpenAI.jo`
implement `Turn` directly to preserve reasoning across the tool loop.
