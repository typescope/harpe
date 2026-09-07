# Changelog

## Unreleased

The agent templates come back from `typescope/agents`, with that repository's
history, and live under `templates/`. `jo-templates.jsonl` at the root names
them, so `jo new --template typescope/harpe:web` replaces
`typescope/agents:web`.

They keep the pin that made the split worth making: every manifest under
`templates/` resolves a published release rather than the sources beside it, so
an API change on `main` still does not have to be made in six applications at
once. What goes away is the two-repository tax — an agent and the tutorial that
documents it now change in one pull request, and `cli/` is no longer mirrored
across a repository boundary at each release.

`cli` is no longer offered as a template. It stays in `cli/`, built from these
sources, as the framework's end-to-end test subject, and its tutorial is
removed. `smart-logistics` joins the set, so there are still six.

Their checks run in a `Templates` workflow that fires only on a pull request
touching `templates/`. It is deliberately not the release gate — RELEASE.md
step 8 retargets the pins after publication, now as a pull request against this
repository.

The documentation gains a **Case Studies** section. The PR review and flight
booking pages move there from Tutorials, keeping their old URLs as redirects,
and `smart-logistics` gets the page it did not have. A tutorial teaches a piece
of the framework in order. A case study leads with a problem, says why a
conventional sandbox or a prompt instruction does not solve it, and shows the
finished application — so the two are no longer competing for one section.

## 0.9.0 — 2026-09-01

Ninth developer-preview release. It publishes the test framework as a package of
its own, `harpe-testing`, and moves the agent templates out to
[typescope/agents](https://github.com/typescope/agents), leaving this repository
the framework and one CLI agent. In the runtime it simplifies the approvals API
and fixes how a reply the token limit cut off is read.

### harpe-caps 0.9.0

No changes. The capability interfaces are identical to 0.8.0. The version moves
with `harpe` so applications can keep one constraint for both packages.

### harpe 0.9.0

Breaking changes:

- `Approvals.Request` is removed. `Approvals.request` and `Interact.approve`
  take `title` and `detail` directly, so a caller writes
  `interact.approve(title, detail)` rather than wrapping two strings in a class
  first. Custom `Interact` and `Approvals` implementations need their signatures
  updated to match.

New:

- `models.anthropic(..., baseUrl = ...)` points the client at an endpoint other
  than `https://api.anthropic.com`, which is what a gateway or a local proxy
  needs.

Fixed:

- A reply the token limit cut off is no longer lost to a JSON error. OpenAI
  Responses, OpenAI-compatible Chat Completions, and OpenRouter now test for
  truncation before they parse tool calls, because the last call of a cut-off
  reply carries arguments that stop mid-JSON — the very reply that branch
  exists to handle.

- A streamed Chat Completions reply is read from the accumulated snapshot
  instead of `get_final_completion()`. That helper promises a fully parsed
  result and so refuses a truncated one, while this adapter parses the raw
  message itself.

- A call to a tool that does not exist reports `success = false` instead of
  passing an error message off as a successful outcome.

- The optional OCR backend follows RapidOCR to the `rapidocr` package and its
  separate `onnxruntime` engine. The old `rapidocr-onnxruntime` distribution
  held the environment below Python 3.13.

### harpe-testing 0.9.0

The test framework — the suite tree, the runner, and the assertions — published
as a package so that a project outside this repository can declare a test module
against it. It depends on nothing, not even `harpe`. Nothing in it knows what an
agent is. Its nine host calls are bound in its own platform module rather than
borrowed from `harpe.ffi`, which is what keeps it free-standing.

Version 0.8.0 was published without notes. Relative to it:

- A suite declared `parallel = true` tells the runner its direct children may
  run at once. The runner turns such a suite into one pool of work items, a
  nested parallel suite flattens into the same pool, and a serial child stays a
  single item, which is what keeps its subtree ordered. Reporting stays in
  declaration order either way.

- A suite rejects two children that share a name, so a filter naming a test
  always selects one test.

## 0.8.0 — 2026-08-28

Eighth developer-preview release. It makes streaming a first-class part of a
turn and lets context strategies compact between tool rounds, while preserving
the logical turn. It also tightens several names and interfaces introduced in
the previous previews.

### harpe-caps 0.8.0

No changes. The capability interfaces are identical to 0.7.0; the version moves
with `harpe` so applications can keep one constraint for both packages.

### harpe 0.8.0

Breaking changes:

- `Context` now models the turn lifecycle directly. `mark`, `render`, and
  `rollback` are replaced by `beginTurn`, `compact`, `commitTurn`, and
  `abortTurn`. `compact` returns `Context.Result`, containing the rendered
  snapshot and whether the provider session must be restarted. Custom context
  strategies need to implement this new interface.

- `Model.Session.reply` takes the active `Interact` as its third argument. A
  provider uses it to emit streaming events and observe cancellation. The
  callback accepted by `Model.SimpleSession` gains the same argument.

- `Tool.RunOutcome` is renamed to `Tool.ToolOutcome`. Its `attachments`
  argument now defaults to an empty list, so ordinary text-only outcomes need
  only `result` and `summary`.

- `Interact.approve` no longer takes an ID. Correlation belongs to the
  interaction implementation, so callers pass only the approval request.

- The `compatible` switch is removed from `models.openai`. Portable Chat
  Completions providers are now constructed explicitly with
  `models.openai.compatible(...)`.

New:

- OpenAI Responses, OpenAI-compatible Chat Completions, Anthropic, and
  OpenRouter stream assistant text through `TurnEvent.AssistantChunk`.
  `AssistantStreamReset` tells a UI to discard provisional chunks when a model
  request is retried.

- Context strategies may compact at any model-call boundary, including between
  tool rounds. `TurnContext` is available for sessions that retain only the
  active turn.

- `models.openai(..., store = false)` supports stateless Responses calls while
  preserving encrypted reasoning and tool-loop state locally.

- Provider `Retry-After` headers are honored through the new
  `Model.RetryAfter` result instead of being replaced by the default backoff.

## 0.7.0 — 2026-08-25

Seventh developer-preview release. It is a context-parameter pass: the two
values the framework used to pass ambiently — the interaction channel and the
logger — become ordinary arguments, so what a turn and a tool handler receive is
visible in their signatures. A driver written against 0.6.0 needs the changes
listed below, all of which are mechanical.

The turn engine, the context strategies, the transcript, and the sandbox behave
exactly as in 0.6.0. The one behavioural change is that a reply's token budget is
now the caller's to set.

### harpe-caps 0.7.0

No changes. The capability interfaces are identical to 0.6.0 — the version moves
with `harpe` so a driver pins one constraint for both.

### harpe 0.7.0

Breaking changes:

- `interact` is an ordinary parameter of `Agent.ask` rather than an ambient
  context parameter, and `param interact` is gone from `harpe.Interact`. A
  driver that opened a turn with

  ```jo
  with interact = channel in
    Agent.ask:
      prompt
      brain = brain
  ```

  now passes the channel by name:

  ```jo
  Agent.ask:
    prompt
    brain = brain
    interact = channel
  ```

  `Interact.unattended` remains the default, so a turn with nobody watching is
  still `Agent.ask("hello")`.

- `Tool.Handler` is `(ToolInput, Interact) => RunOutcome receives logger`. The
  turn hands the selected handler its own channel, which is what lets a driver
  keep building one `Toolset` per session. A handler that ignores it names the
  parameter `_`:

  ```jo
  Toolset.of: spec, (i: ToolInput, _: Interact) => run(i["fileName"])
  ```

  `Tool.runSafely` takes the channel as a fourth argument for the same reason.

- `param logger: Logger` has no default. Every entry point binds one, and work
  that intentionally records nothing binds `Logging.discard` explicitly rather
  than relying on it being the fallback. `param resources: Resources`, which the
  transcript viewer reads, loses its default on the same grounds.

- `Model.startTurn` is `startTurn(base: Rendered, maxOutputTokens: Int)`. An
  implementation renders the bound as whatever its provider calls the limit, and
  one with no such notion ignores it. The shipped models stop hardcoding it.

- `RunCodeTool.run` takes `interact: Interact = Interact.unattended` after
  `guestEnv`. `RunCodeTool.toolset(...)` is unchanged — it wires the handler for
  you.

- `Journal.turn(data, work)` is removed. Open and close the bracket with
  `request` and `response` directly, which is what a driver whose two halves ran
  on different threads already did:

  ```jo
  journal.request(Journal.payload("text" ~ userInput))
  val turn = Agent.ask(...)
  journal.response(Journal.payload("delivered" ~ delivered))
  ```

  An unclosed bracket is still a fragment, and `records` yields nothing for it.

- `Broker`, `Broker.Client`, and `Frame` are `private[harpe]`. They are the
  host/guest wire protocol, not a surface to build on. `BrokerApprovals` takes
  the socket path rather than a live client, so the private type does not appear
  in a signature the sandbox runtime can see.

New:

- `Agent.ask` takes `maxOutputTokens: Int = 8192`, bounding what the model may
  produce in a single reply. It is fixed for the turn — every round of the tool
  loop is sent with the same bound — and joins `maxToolRounds` and `maxRetries`
  as a budget the caller sets without building a second `Model`. It replaces the
  8096 the OpenAI and OpenRouter backends hardcoded.

## 0.6.0 — 2026-08-23

Sixth developer-preview release. It is a naming and layering pass: the framework
stops assuming where an agent keeps its files, the FFI layer stops using
namespaces as module aliases, and types that were loose at the package root move
under the section that owns them. A driver written against 0.5.0 needs the
changes listed below, all of which are mechanical.

Nothing here changes what an agent *does*. The turn engine, the context
strategies, the transcript, and the sandbox behave exactly as in 0.5.0.

### harpe-caps 0.6.0

Breaking changes:

- The loose record types now live in the section of the capability that returns
  them: `DirEntry` and `FileInfo` under `FileSystem`, `Heading` and
  `PageContent` under `PDF`, `WordHeading` under `Word`, `SheetSize` under
  `Workbook`, and `ImageSize` under `Image`. A guest program written against
  0.5.0 renames its references — `Heading(...)` becomes `PDF.Heading(...)`.

- `MediaProvider`, the `media` param, and the `Media` record are removed. They
  were the pre-`fs` way to hand a guest one file, and nothing has used them since
  `FileSystem` gained document opening. Guests read files through `fs`.

### harpe 0.6.0

Breaking changes:

- `Workspace` and the `workspace` param are gone, with nothing replacing them in
  the framework. Where an agent keeps `sandbox/`, `skills/`, `data/`, and
  `logs/` is that application's convention, not Harpe's, and every built-in tool
  already takes the directory it works in as an ordinary argument. A driver that
  wants one root resolved once declares its own context parameter:

  ```jo
  param appHome: String

  def main(): Unit receives stdout =
    with appHome = os.path.abspath(".") in serve()
  ```

  `workspace.sandboxDir` becomes `os.path.join(appHome, "sandbox")`,
  `workspace.read("AGENT.md")` becomes `File.read(...)`, and so on. The shipped
  drivers show the pattern; `templates/hello` skips the parameter entirely and
  resolves paths against its own directory.

- `Defaults.model()` is now `Model.default()`, and the `Defaults` section is
  gone. The env-var contract (`OPENAI_API_KEY` / `OPENROUTER_API_KEY` /
  `ANTHROPIC_API_KEY`, `MODEL`, `OPENAI_BASE_URL`) is unchanged.

- `runCodeTool(...)` is removed. `RunCodeTool(...)` was always available — a
  class carries its own factory — and it now holds the defaults and the
  `run.sh` check the function existed to add. Call sites change only in case.

- The FFI layer is one namespace. Each `harpe.ffi.<module>` namespace of
  forwarding functions is now an `@py.interop` interface plus one binding in
  `harpe.ffi`, so the declarations carry Python's own names and signatures and
  no bodies to keep in sync. `import harpe.ffi.os` still yields `os.path.join`,
  but members that were Jo-shaped moved out (below), and a few take Python's
  spelling now: `secrets.tokenHex(nbytes = 8)` is `secrets.token_hex(8)`,
  `sys.stdoutWrite(s)` is `sys.stdout.write(s)`.

- Everything in `harpe.ffi` that was not a faithful binding moved to
  `harpe.util`, grouped by what it is for:

  | 0.5.0 | 0.6.0 |
  |---|---|
  | `file.read` / `write` / `exists` | `File.read` / `write` / `exists` |
  | `os.makedirs` | `File.ensureDir` |
  | `os.extname`, `os.walk` | `File.extname`, `File.walk` |
  | `mimetypes.guessType` | `File.mimeType` |
  | `subprocess.runCapped` | `Process.runCapped` |
  | `subprocess.guestEnv` | `Process.guestEnv` |
  | `dotenv.load` | `Process.loadDotenv` |
  | `signal.onSigint` / `shutdownOnSigint` | `Process.onSigint` / `shutdownOnSigint` |
  | `threading.thread` | `Process.daemon` |
  | `time.now` / `toRfc3339` / `fromRfc3339` | `Clock.now` / `toRfc3339` / `fromRfc3339` |
  | `terminal.*` | `Terminal.*` |
  | `text.stripAnsi` | `Terminal.stripAnsi` |
  | `hashlib.sha256Hex` | `Digest.sha256Hex` |

  `Digest`, `UnixSocket`, and `util.truncate` are `private[harpe]`: they are
  framework plumbing with no third-party use. `File`, `Process`, `Clock`, and
  `Terminal` are public.

- Loose types move under the section that owns them, mirroring the caps change:
  `AnthropicCache` is `Anthropic.Cache`, `ApprovalRequest` and the
  `ApprovalDecision` union are `Approvals.Request` and `Approvals.*`, `IntVal`
  and `BoolVal` are `Value.IntVal` and `Value.BoolVal`, `valueToJson` and
  `valueFromJson` are `Value.toJson` and `Value.fromJson`, `BrokerClient` is
  `Broker.Client`, and the `TurnEvent` / `TurnResult` unions gain sections of
  the same name. `Context.NoHistory` is `Context.noHistory`.

New:

- `Tool.RunOutcome` and `Tool.ToolResult` carry `success`, defaulting to `true`.
  It is for code, not for the model: a handler that refuses a call explains
  itself in `result` and sets `success = false`, and a driver reading its own
  output back off the finished turn can tell a refusal from work done. Nothing
  is sent to the provider for it, and it rides into the transcript, so a
  reloaded turn knows which of its calls were refused. See
  [Tools](https://harpe.typescope.ai/concepts/tools/).

- `Entry.readJsonl(path)` reads a JSONL log back into `Entry` values — the
  missing half of `JsonlLogger`. It is strict: a missing file raises, because
  what an absent journal means is the caller's to decide. A driver reading it as
  "this session has not spoken yet" checks `File.exists` first.

## 0.5.0 — 2026-08-21

Fifth developer-preview release. It separates the *transcript* — the conversation
a user had — from the *log* of everything that happened, and removes two
abstractions the framework had no business fixing. A driver written against 0.4.0
needs the changes listed below.

0.4.0 wrote conversation records through a `Transcript` section wired to the
ambient logger, and every turn the engine ran produced them — a subagent's, a
background job's, a script's. Nothing distinguished those from the user's own
turns, so a page rendering "the conversation" was rendering whatever had passed
through the process. A turn is now part of the transcript because a driver
bracketed it, and both the page and the model's resumed history derive from that
same gate.

### harpe-caps 0.5.0

- No changes. The capability interfaces are identical to 0.4.0. The version moves
  with `harpe` so the two packages a project depends on always carry the same
  number — a mismatched pair reads like a mistake even when it is correct.

### harpe 0.5.0

Breaking changes:

- `Agent.runTurn` is now `Agent.ask`, and takes the message and its attachments
  rather than a `UserInput`:

  ```jo
  Agent.ask("what is on this chart?", ["reports/q3.png"], brain = brain, tools = tools)
  ```

  `attachments` are paths; their name, size, and mime type are read off disk.
  `Model.stringInput` is gone with the coercion it existed for. Note the
  parameter order — `attachments` is second, so calls that passed `brain`
  positionally must now name it.

- `Transcript` is an interface, and the framework's implementation is `Journal`.
  It declares only what the engine calls — `start`, `append`, `commit`,
  `interrupted`, `failed` — and an application that keeps conversations in a
  database implements it instead. `Agent.ask` takes a `transcript` parameter,
  defaulting to `Transcript.NoTranscript`.

  The reading side moved with it: `Transcript.turns` is gone, and
  `Transcript.records`/`fromEntries` are now `Journal.records`/`fromEntries`.
  `TurnRecord` is `Journal.TurnRecord`, and carries `(request, response, data)`
  with no id — a journal holds one conversation whose turns pair in order.

- A turn only enters the transcript if a driver brackets it. `Journal.turn(data,
  work)` writes the opening record, runs the turn, and writes the closing one
  from what the work returns; `request`/`response` write the halves separately
  where they cannot share a call. Both payloads are opaque `Value`s the driver
  defines and parses. Turns without a bracket stay in the log and appear in
  neither the transcript nor the resumed history.

- `Attachment` loses `inline`. Attaching a file now *is* the decision to show it
  to the model. A driver that wants the model merely told about a file names it
  in the message text — `Model.userContent` builds that manifest — which is what
  the web and Telegram drivers do, so an upload costs nothing until the agent
  reaches for it.

- `Memory` and `MemoryTools` are removed. Working memory was a second way to
  persist state next to a filesystem the agent already has. An agent that needs
  it keeps a notes file and maintains it with `fs`; a driver that wants those
  notes in front of the model renders them from its own `Context`.

- `Rendered` loses `transient`. Every provider rendered it as one trailing user
  message, which a `Context` can append to `messages` itself. `FullContext`,
  `WindowedContext`, and `SummarizingContext` all take `(baseSystem, initial)`
  now, with `SummarizingContext`'s knobs following.

- Model history derives from the transcript. `Journal.fromEntries` folds only
  bracketed turns, so what the model resumes with and what the page shows cannot
  disagree — and a subagent sharing a session's log can no longer splice its
  conversation into the parent's history.

Added:

- `Http` — WSGI plumbing shared by anything harpe serves: an ambient `Request`,
  verb and path patterns (`Http.Get`, `Http.Post`, `Http.Segments`), body and
  query readers, response helpers, and a threaded `Http.server`. The web driver
  is built on it.

- A journal viewer. Declare a module linking `harpe.transcript.serve` and run
  `jo run view -- logs/sessions/<session>.jsonl` for a live browser view of one
  session: turns as cards with their outcome, machinery shown outside them, and
  filtering. It binds `127.0.0.1` and has no authentication.

Fixed:

- Web returned `500` on an empty or malformed request body across seven
  endpoints. `Http.readJson` yields an empty object instead, so each handler's
  own validation answers.

- Web routes that never checked the method — `POST /api/info` and `GET
  /api/message` both used to succeed — now match on verb and path together.

Migration:

Two things are not handled for you. Sessions recorded by 0.4.0 have no brackets,
so they render as empty history and resume cold; convert them or accept the
break. And `.memory.json` files are no longer read by anything.

## 0.4.0 — 2026-08-20

Fourth developer-preview release. It removes the `Agent` class and wires a
tool's spec to the code behind it, so a driver written against 0.3.0 needs the
changes listed below.

0.3.0 split a tool in two and asked the driver to carry both halves: a
`List[Tool]` of specs the model was offered, and a separate `Map[String,
Handler]` the engine dispatched on. That made every driver name its tool groups
twice, and left "every spec has a handler" as a rule the engine checked at run
time. A `Toolset` holds the pair as one entry, built where the tool is declared.

### harpe-caps 0.4.0

- No changes. The capability interfaces are identical to 0.3.0. The version
  moves with `harpe` so the two packages a project depends on always carry the
  same number — a mismatched pair reads like a mistake even when it is correct.

### harpe 0.4.0

Breaking changes:

- `Agent` is a section, not a class. An agent is not one component but the way a
  model, its tools, and its context are coordinated for a turn, so there is
  nothing left to instantiate. `new Agent(brain, tools, context)` followed by
  `agent.runTurn(...)` becomes a single `Agent.runTurn(...)`, and every input is
  a parameter with a default:

  ```jo
  val tools = MemoryTools.toolset(store) ++ runCode.toolset()

  Agent.runTurn:
    input
    brain
    tools
    context
    maxToolRounds = 10
    maxRetries = 2
  ```

  The plainest turn is now `Agent.runTurn("hello")`.

- `Toolset` replaces the `tools: List[Tool]` and `handlers: Map[String,
  Handler]` argument pair. A `Toolset` maps each name to its spec and its
  handler together, and drivers join what each tool contributes with `++`.
  Wiring one name twice aborts as the toolset is built, rather than silently
  keeping one of the two. Because no spec can be offered without a handler, the
  engine's run-time check that every tool was wired is gone.
- Each shipped tool contributes its own wiring, so a driver no longer repeats
  the argument names the model fills in. `MemoryTools.toolset(store)`,
  `SkillTools.toolset(dir)`, `UploadMediaTool.toolset(dataDir)`, and
  `runCode.toolset(guestEnv)` each return a `Toolset`.
- The stateless shipped tools are sections rather than classes. `new
  MemoryTools(store)` and `new SkillTools(dir)` are gone, and their verbs take
  what they work on as an argument — `MemoryTools.read(store, key)`,
  `SkillTools.search(dir, query)`. `runCodeTool(...)` still returns a
  `RunCodeTool`, which owns its build semaphore and sandbox directory.
- `Model.Message.UserText` is renamed `UserInput`, matching the `input`
  parameter it is passed as. A transcript written by 0.3.0 reads back unchanged
  — only the Jo constructor name moves.
- `runTurn`'s `input` coerces from a plain string, so a driver with no file
  support writes `Agent.runTurn(text)` instead of `UserText(text, [])`. A driver
  that accepts uploads builds the `UserInput` itself, with the attachments it
  saved.

Other changes:

- `param interact` defaults to `Interact.unattended` and `param logger` to
  `Logging.discard`. A turn with neither bound runs with nobody watching and
  nothing recorded, rather than failing on an unbound parameter. A driver with a
  user to answer to still binds its own.
- `runTurn`'s `context` defaults to `NoHistory`, a fresh context that holds the
  turn it is given and is discarded when the turn ends. A session that should
  remember keeps a real strategy alive across turns.
- The agent, tools, logging, media, memory, and skills guides and the tutorial
  are revised for the merged toolset, and the design doc records why the spec
  and its handler are kept together.

This release remains a developer preview, with the same guidance as 0.1.0 on
irreversible actions.

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
