+++
title = "Prompt Caching"
+++
Prompt caching lets a provider reuse the work it already did on a prompt prefix
it has seen before, billing those tokens at a reduced rate instead of processing
them again. It changes no output. The model sees the same prompt either way.

Caching matters more for an agent than for a single question. A user turn is not
one request. Each time the agent returns a tool result, it asks the model to
continue, and everything before that result — the system prompt, the tool
specifications, the whole transcript so far — is sent again. A turn with six
tool calls re-sends its prefix six times. Across turns, the same system prompt
and tool list lead every request the agent will ever make.

That shape is what caching is for. The prefix is long, stable, and repeated,
while only the tail is new.

## Breakpoints and the stable prefix

A cache entry covers a *prefix* of the prompt, so what can be cached depends on
what stays byte-identical from one request to the next. Harpe's request layout
puts the most stable content first:

| Position | Content | Changes |
|---|---|---|
| 1 | Tool specifications and system prompt | Never, for a given agent |
| 2 | Conversation transcript | Grows, append-only |
| 3 | Transient tail | Every turn |

A *breakpoint* marks where a cacheable prefix ends. Both
[Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
and [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) cap a
request at four cache writes, so breakpoints go where the prefix is stable: at
the end of the tool list and system prompt, and at the end of the transcript. The
transient tail stays uncached, because caching content that changes every turn
only pays the write cost and never earns a read.

An append-only transcript is what makes the second breakpoint worthwhile. Harpe
never rewrites history mid-turn, so each request in a tool loop extends the
previous prefix rather than invalidating it.

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
`Anthropic.NoCache` sends no breakpoints at all, and the system prompt reverts to a plain string, byte-identical to a request
from an agent that never enabled caching.

Anthropic's minimum cacheable prompt varies by model — shorter prompts are simply
processed uncached, with no error — so check the
[current thresholds](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
if a small agent shows no cache reads at all.

The policy is an argument to the constructor:

```jo
val brain = anthropic(apiKey, "claude-opus-4-6", cache = Anthropic.OneHour)
```

[`Model.default()`](/concepts/models/) uses `Anthropic.FiveMinutes`. It selects a
provider from environment variables and deliberately stops there: a cache policy
is provider-specific tuning, so an agent that wants a different one calls
`anthropic(...)` itself rather than reaching for an environment variable that
only one provider would honor.

## OpenAI

[OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)
needs no opt-in. The provider caches eligible prefixes on its own, for prompts of
1024 tokens or more, and the default `implicit` mode places a breakpoint on the
latest message. There is no field that turns it on.

There is, however, a field that makes it hit more often. On `gpt-5.6` and later
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
suggests roughly 15 requests per minute per key. A single busy agent sharing one
system prompt across many concurrent users sits on one key.

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

Every reply emits a `harpe.model` event through the
[Logger](/concepts/logging/) carrying `inputTokens`, `cacheReadTokens`, and
`cacheWriteTokens`. The two cache fields are parts of `inputTokens`, so their
share of it is the hit rate.

```sh
jq -s 'map(select(.category=="harpe.model"))
       | {input: (map(.inputTokens) | add),
          read:  (map(.cacheReadTokens) | add),
          write: (map(.cacheWriteTokens) | add)}' logs/sessions/<session>.jsonl
```

> **Note.** The query assumes a JSONL backend. Storage is the application's
> choice, and the same fields answer the same question in any other — see
> [Reading and querying](/concepts/logging/#reading-and-querying).

A working cache shows `cacheReadTokens` covering most of `inputTokens` on the
second and later requests of a turn, and on the stable prefix of a follow-up turn
that arrives within the cache lifetime. Writes concentrated in the first request
of each turn are normal. Writes on *every* request mean the prefix is not stable
— a context strategy rewriting history is the usual cause.

Providers report these counts on different bases, and the adapters normalize
them: Anthropic's `input_tokens` counts only the tokens after the last cache
breakpoint, so Harpe adds the cached halves back, while OpenAI's already includes
them. `inputTokens` therefore means total input on every provider and sums across
them.

The first request of a turn writes rather than reads, and a write costs more
than an ordinary input token. Caching pays off through repetition, so it is
worth the most on exactly the workload agents produce — a long stable prefix,
many requests — and worth the least on a single short one-shot exchange.
