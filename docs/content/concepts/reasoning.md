+++
title = "Reasoning"
weight = 4
+++
Modern models can **reason** before they answer — work through a problem
step by step internally, then reply. On hard tasks this raises quality, and for
an agent it matters most across a **tool loop**: the model reasons, calls a tool,
reads the result, and keeps reasoning from where it left off instead of starting
over each step.

Harpe turns reasoning on for you and preserves it across a turn's tool calls. In
most cases you write no code — pick a reasoning-capable model and it just works.

## It is on by default

When the agent's model is OpenAI or Anthropic, reasoning is enabled out of the
box (see [Models](/concepts/models/) for how the model is selected). You do not
call a special API or set a flag to get it. A single user turn — the model
thinking, calling tools, reading results, and thinking again until it answers —
carries the model's train of thought the whole way through.

## What you get back

You get the model's **final answer** and its **tool calls** — the same shape as a
non-reasoning reply. You do **not** get the reasoning itself: providers do not
return the raw chain of thought, so there is no "thinking" text in the transcript
or the [log](/concepts/logging/). Treat reasoning as something the model does,
not something your code reads.

## Configuring it

### OpenAI

Set how hard the model reasons with the **`REASONING_EFFORT`** environment
variable:

| Value | Effect |
|-------|--------|
| `medium` | Default — a balanced amount of reasoning. |
| `low` | Less reasoning: faster and cheaper, for simple work. |
| `high` | More reasoning: for the hardest tasks. |
| `none` | Reasoning off. Required for a non-reasoning model such as `gpt-4o`. |

Under the hood this uses OpenAI's **Responses API**, which keeps the turn's
reasoning on OpenAI's servers between tool calls. That means it depends on
server-side storage being available for your account — if your organization has
disabled response storage (e.g. a zero-retention policy), reasoning across tool
calls will not work; use `REASONING_EFFORT=none` or a different provider.

### Anthropic

Anthropic uses **adaptive thinking**: the model itself decides when and how much
to reason, per request. There is nothing to configure — and nothing to preserve
on your side, Harpe handles it. This is deliberate: how a model reasons is the
model's business, so each provider exposes only the controls that are meaningful
for it rather than a lowest-common-denominator knob.

## Model requirements

Reasoning needs a model that supports it:

- **OpenAI** — a reasoning model (the `gpt-5` family, the `o` series). For a
  non-reasoning model like `gpt-4o`, set `REASONING_EFFORT=none`.
- **Anthropic** — Claude Opus 4.6 or newer, or a current Sonnet. The default
  model reasons; an older `MODEL` override may not.

Point the agent at a model that can't reason without turning reasoning off and
the request will fail — pick the model and the setting together.

## Cost and truncation

Reasoning is not free: the tokens the model spends thinking count against its
**output budget** for that reply, even though you never see them. Two practical
consequences:

- Reasoning replies cost more and take longer than the visible output suggests.
  Lower `REASONING_EFFORT` (OpenAI) when a task doesn't need deep thinking.
- If a reply comes back cut off, a long reasoning burst likely crowded out the
  answer. That surfaces as a truncated reply in the transcript — the signal to
  either simplify the request or dial reasoning down.
