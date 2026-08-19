# Changelog

## 0.3.0 — 2026-08-19

Third developer-preview release. It separates a tool's description from its
execution, so a driver written against 0.2.0 needs the changes listed below.

A tool used to be one object holding both what the model is offered and the code
that runs. Those two things have different lifetimes: a description is timeless,
while an executor belongs to one turn, one session, one data directory. Bundling
them meant contextual values had to reach a long-lived object through an untyped
string map. `Tool` is now the description alone, and a driver wires each name to
a handler for each turn.

### harpe-caps 0.3.0

- No changes. The capability interfaces are identical to 0.2.0. The version
  moves with `harpe` so the two packages a project depends on always carry the
  same number — a mismatched pair reads like a mistake even when it is correct.

### harpe 0.3.0

Breaking changes:

- `Tool` is an interface describing a spec — `name`, `description`, `params` —
  and no longer carries `run`. What runs is a `Handler`, a
  `ToolInput => RunOutcome receives logger, interact` that the driver supplies:

  ```jo
  val handlers: Map[String, Handler] = Map:
    runCode.name        ~ (i => runCode.run(i["code"]))
    upload.name         ~ (i => upload.show(i["fileName"], dataDir))
    mem.updateSpec.name ~ (i => mem.update(i["key"], i["value"]))

  agent.runTurn(userMsg, handlers, maxToolRounds = 50, maxRetries = 4)
  ```

- `Agent.runTurn` takes that map and no longer takes an `Interact` argument. The
  driver binds the channel around the call instead — `with interact = channel in
  agent.runTurn(...)`. A spec with no route aborts the turn before the model is
  called, rather than surfacing mid-turn as an unknown tool.
- `param currentInteract` is renamed `interact`, and the engine no longer
  rebinds it around each tool call. One name, one binding, held for the turn.
- `CallContext` and `param callContext` are removed. `runCode` takes the guest
  environment as an argument — `run(code, guestEnv)`, defaulting to none — and a
  tool that needs the session's data directory receives it from its route.
- `Model.Attachment` gains `path`, where the file's bytes live. Nothing below
  the driver is told a data directory any more: `Model.Session.reply` drops
  `receives callContext`, and `readInlineBase64` takes a path.
- `Tool.RunOutcome.media` and `Tool.ToolResult.media` are renamed `attachments`,
  matching `Model.UserText`, which already called a `List[Attachment]` by that
  name. A tool result serializes them under `"attachments"` as well. A
  transcript written by 0.2.0 reads a tool result's attachments back as empty,
  which does not affect rendering — a past tool result is never re-inlined.
- `Defaults.tools` is removed. A driver constructs the tools its agent needs, so
  the whole surface is readable in one place.
- The shipped tools are objects rather than `List[Tool]` factories.
  `runCodeTool(...)` returns a `RunCodeTool` and `uploadMediaTool()` an
  `UploadMediaTool`, each a spec with typed methods. `skillTools(dir)` and
  `memoryTools(store)` become `new SkillTools(dir)` and `new MemoryTools(store)`,
  which offer `specs` for the agent plus one method per verb for the routes.
- `Tool.runSafely(name, handler, input)` replaces `runSafely(tool, input)`. The
  engine still wraps every route in it, so a driver's wiring cannot take a turn
  down.

Other changes:

- `Tool.ToolInput.get(key)` reads a string argument, so a route can index its
  input: `i => runCode.run(i["code"])`.
- The shipped tools are written as classes, each holding its own configuration —
  `runCode`'s build semaphore, a skills directory, a memory store — so one
  instance serves every session and per-turn values arrive as arguments.
- The tools, media, models, agent, memory, skills, logging, and structured
  output guides are revised for the split, and the tutorial shows both wiring
  sites.

This release remains a developer preview, with the same guidance as 0.1.0 on
irreversible actions.

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
