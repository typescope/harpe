+++
title = "Prompt Caching"
+++
Prompt caching lets a provider reuse the work it already did on a prompt prefix
it has seen before, billing those tokens at a reduced rate instead of processing
them again. It changes no output. The model sees the same prompt either way.

## Breakpoints and the stable prefix

A cache entry covers a *prefix* of the prompt, so what can be cached depends on
what stays byte-identical from one request to the next. Harpe's request layout
puts the most stable content first:

| Position | Content | Changes |
|---|---|---|
| 1 | Tool specifications and system prompt | Never, for a given agent |
| 2 | Context | Usually grows, append-only |
| 3 | Transient tail | Every turn |

A *breakpoint* marks where a cacheable prefix ends. Both
[Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
and [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) cap a
request at four cache writes, so breakpoints go where the prefix is stable: at
the end of the tool list and system prompt, and at the end of the context. The
transient tail stays uncached, because caching content that changes every turn
only pays the write cost and never earns a read.

> **Context strategies interact with caching.** A strategy that rewrites or
> summarizes earlier history changes the prefix, so the next request misses the
> cache and writes a new entry. This is a real cost, not a bug — but it is a
> reason to compact on a boundary rather than on every turn. See
> [Context](/concepts/context/).

## Anthropic

[Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
is explicit: the request carries cache breakpoints, and the policy chooses their
lifetime.

```jo
section Anthropic
  union Cache = NoCache | FiveMinutes | OneHour
end
```

`Anthropic.FiveMinutes` is the default ephemeral lifetime. `Anthropic.OneHour`
survives longer idle gaps, which suits an agent whose user pauses between turns,
but its writes are billed at 2x the base input rate against 1.25x for the
five-minute cache, so it only pays off if the gap it covers is real.
`Anthropic.NoCache` disables prompt caching.

Anthropic's minimum cacheable prompt varies by model — shorter prompts are simply
processed uncached. Check the
[current thresholds](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
for more details.

The policy is an argument to the constructor:

```jo
val brain = anthropic(apiKey, "claude-opus-4-6", cache = Anthropic.OneHour)
```

## OpenAI

[OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)
needs no opt-in. The provider caches eligible prefixes on its own, for prompts of
1024 tokens or more, and the default `implicit` mode places a breakpoint on the
latest message.

On `gpt-5.6` and later
families, only requests carrying a `prompt_cache_key` get OpenAI's improved
matching. The key is a routing hint that steers requests sharing a long common
prefix to the same cache. Omitting it degrades the hit rate rather than breaking
anything — such requests still cache, falling back to prefix hashing alone, and
never fail for want of a key. Harpe sends one on every Responses request, derived
from the digest of the system prompt:

```
prompt_cache_key = "harpe:" + sha256(system)[0..16]
```

Two requests built on the same system prompt therefore share a key, and
unrelated agents stay apart, with no configuration and no identifier to thread
through the application. High-volume deployments should know that OpenAI
suggests roughly 15 requests per minute per key.

Within a turn, the Responses path also chains requests with
`previous_response_id`, so the server retains the prefix and the reasoning items
along with it. See [Reasoning](/concepts/reasoning/).

## Other providers

OpenRouter and OpenAI-compatible servers send no cache-control fields. Whether a
prefix is cached is up to the endpoint: many local inference servers do automatic
prefix caching — [vLLM](https://docs.vllm.ai/en/stable/design/prefix_caching.html)
and SGLang's RadixAttention among them — and their reuse is a property of the
server rather than of the request.

## Reading the effect

Every reply emits a `harpe.metering.usage` event through the
[Logger](/concepts/logging/) carrying `inputTokens`, `cacheReadTokens`, and
`cacheWriteTokens`. The two cache fields are parts of `inputTokens`, so their
share of it is the hit rate.

```sh
jq -s 'map(select(.event=="harpe.metering.usage"))
       | {input: (map(.fields.inputTokens) | add),
          read:  (map(.fields.cacheReadTokens) | add),
          write: (map(.fields.cacheWriteTokens) | add)}' logs/sessions/<session>.jsonl
```

> **Note.** The query assumes a JSONL backend. Storage is the application's
> choice, see [Logging](/concepts/logging) and [Observability](/concepts/observability).

Providers report these counts on different bases, and the adapters normalize
them: Anthropic's `input_tokens` counts only the tokens after the last cache
breakpoint, so Harpe adds the cached halves back, while OpenAI's already includes
them. `inputTokens` therefore means total input on every provider and sums across
them.

