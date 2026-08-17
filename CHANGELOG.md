# Changelog

## 0.2.0 — 2026-08-17

Second developer-preview release. It reshapes how a turn is returned, so a
driver written against 0.1.0 needs the changes listed below.

### harpe-caps 0.2.0

- Documentation only. The capability interfaces are unchanged from 0.1.0.

### harpe 0.2.0

Breaking changes:

- `Agent.runTurn` returns `TurnData` instead of `TurnResult`. A `TurnData`
  carries the user message, the messages the turn produced, and how it ended,
  so a live turn and one replayed by `Transcript.turns` are the same value.
  Render a finished turn with `TurnData.text`, or use `TurnData.finalText` for
  the closing reply alone when the earlier parts have already been shown.
- `TurnResult.Answered(text)` becomes `TurnResult.Success`, which carries
  nothing. The assistant text lives on the surrounding `TurnData`.
- `Defaults.checkAgentDir` is removed. Checking that the process starts in an
  agent working directory is a driver concern, not a framework one.
- `Defaults.model()` no longer reads the `PROMPT_CACHE` environment variable.
  It fixes Anthropic's prompt cache to the default five-minute policy. An agent
  wanting another policy calls `anthropic(...)` itself.

Other changes:

- OpenAI requests carry a `prompt_cache_key` derived from the system prompt,
  which gpt-5.6 and later need to stay on the reliable prefix-matching path.
- Usage accounting reports `inputTokens` as the total input the provider
  processed, cached tokens included, so the number means the same thing on
  every provider. The `harpe.model` log event gains `cacheReadTokens` and
  `cacheWriteTokens`, which break that total down.
- New prompt caching guide, a documentation home page, and revised billing,
  logging, models, and structured output guides.

This release remains a developer preview, with the same guidance as 0.1.0 on
irreversible actions.

## 0.1.0 — 2026-08-05

Initial developer-preview release of Harpe, a typed, capability-constrained
agent framework for Jo.

### harpe-caps 0.1.0

- Pure Jo capability interfaces for files, paths, documents, workbooks, images,
  OCR, PDFs, media, and binary data.
- A sandbox-safe API surface with no FFI dependency.

### harpe 0.1.0

- Core agent loop with OpenAI, Anthropic, and OpenRouter model support.
- Compile-time capability restriction for model-generated Jo programs.
- Sandboxed task execution with trusted host-side capability implementations.
- Context compaction, persistent sessions, memory, logging, tools, skills, and
  media handling.
- CLI, web, Telegram, and minimal learning-agent applications.
- File, document, spreadsheet, image, OCR, and PDF capabilities.

This release is intended for developer preview. Applications performing
irreversible actions should keep those actions read-only, queued, or protected
by trusted approval code.
