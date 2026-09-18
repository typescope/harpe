# Changelog

## Unreleased

**A route answers with an `Http.Response` value rather than writing to WSGI.**
Its type is `() => Http.Response receives Http.request`, where it was
`() => py.List`. `Response` is `Complete(status, headers, body)` or
`Stream(kind, produce)`, and `Http.app` is the only code that writes it, so no
route signature mentions WSGI and `Request.startResponse` is gone. A route's
answer can now be inspected, and a wrapper can add to it.
`Http.Status.Other(code, reason)` carries a status decided at runtime, such as
one relayed from upstream.

The builders live in `Http.Response`, beside the type, so a route imports
`harpe.Http.Response` and answers `Response.html(page)`. They were functions on
`Http`, most of them named `respond*`:
`Response.complete(status, kind, headers, body)`, `Response.binary`,
`Response.html`, `Response.json`, `Response.stream`, `Response.redirect`,
`Response.notFound` and `Response.badRequest`.

**`Response.complete` and `Response.binary` take a `Status.Code` and a `Mime.Type`
rather than strings.** `Http.jo` already made this argument for the verb — a
closed union refuses at the door what a string carries inward — and the status
line was the half that never got it, so `"200 0K"` was a typo no compiler could
see. `Http.Status.Code` names the statuses a web application commonly answers
with, and `Http.Mime.Type` the content types it writes in source, which settles
each one's charset in a single place rather than at every call site.
`Mime.Other` carries a type resolved at runtime, which is what a file's own is.

Both also take a `List[Http.Header]`, sent after the content type, so a route can
redirect, set a cookie or name a download without reaching into WSGI.
`Response.redirect` is the 303 a form post wants. Every response carries
`X-Content-Type-Options: nosniff`, and a header containing a line break aborts
rather than splitting the response.

**`Http.beginStream` is now `Response.stream`.** It handed back WSGI's raw `write`
callable for the caller to push bytes into. It takes the producer instead —
`Response.stream(Mime.Ndjson, emit => …)` — so the callable stays inside one
function and a server that ever needs the iterable form changes only there.
`emit` returns whether the client is still there. wsgiref and waitress raise
different exceptions for a closed connection, and the producer sees neither, only
`false` from then on, so it can stop work nobody will read.
`Mime.EventStream` and `Http.Sse` frame server-sent events. Both
forms were measured to flush per chunk on waitress and wsgiref, so the callable
stays: a turn pushes into a sink, and the iterable form would mean a queue and a
second thread for every open stream.

**`Http.app` turns a route into a plain WSGI application**, which a deployment
runs on the WSGI server it chooses, so harpe installs none. The tests run it on
waitress as well as wsgiref.

**`Http.server` is gone.** An application serves `Http.app` on the server it
chose, in development as in production. harpe's own journal viewer and test
fixtures use `Http.serveInBackground`, which is wsgiref on a daemon thread and
private to harpe.

`Http.app` takes `Http.Settings`, and refuses before any route runs: a verb this
plumbing does not implement (501), a path that is not UTF-8 (400), a `Host`
outside `settings.hosts` (400), a cross-site POST, PUT or DELETE under
`CrossSite.Refuse` (403), and a body declaring more than `settings.maxBodyBytes`
(413). The host check is what stops DNS rebinding from reading a loopback
server, and the cross-site check is Go's `CrossOriginProtection`, which needs no
token. The body readers read exactly what `CONTENT_LENGTH` declares, which `app`
has already held to the limit. `Viewer.start` takes the host policy its caller
binds for.

**Request readers answer `Option` rather than a fallback.** `Http.queryParam`
is None for an absent parameter and `Some("")` for an empty one. `Http.readJson`
is None unless the request says `application/json` and the body is an object,
where it used to answer `{}` for all of those alike. `Http.readBody` is None for
a body that is not UTF-8, and `Http.readBytes` reads it raw. `Http.header` reads
a request header. `Request.path` is decoded as UTF-8, where WSGI hands over
Latin-1, so a route now matches `/café` as written. `Http.Put` and `Http.Delete`
join the verb patterns.

`Http.cookie` reads a cookie leniently, as browsers write them. A second read of
the body in one request aborts, where it used to come back empty and read as a
missing body.

**The `Http.Segments` pattern is gone**, and `Http.segments(path)` stays. The
pattern split the path inside each case, so a route file that used it in twenty
cases split twenty times: 328us, against 74us for a whole request, measured on
Jo 0.13.4. A route that needs the parts of a path splits once and matches the
list. In a single-page application a parameter travels as a query parameter or
in the body anyway, uniformly, since the client builds every request. The verb
patterns' doc comment also claimed a regex string worked as a path pattern. It
never did — a string pattern is an exact comparison.

**`Http` serves single-page applications and APIs**, which is now stated in
`Http.jo`: JSON, streams, and files read from disk, where a page is a file. It
renders no HTML and escapes nothing, so `Http.readForm` is gone — reading a
posted form only makes sense beside the server-side rendering it does not do.

**Cookies are written from `Response` and read from `Http`**, the same split as
the rest: `Response.cookie(name, value, maxAgeSeconds, secure)` builds a
`Set-Cookie` that is always `Path=/`, `HttpOnly` and `SameSite=Lax`, and answers
a `Header` to pass in a response's headers. It was `Http.setCookie`.

**`Response.signedCookie` and `Http.signedCookie` carry a value a client cannot
change.** The cookie holds the value, its expiry and an HMAC-SHA256 over both
and the cookie's name, so it cannot be altered or moved to another name, and the
server enforces the expiry rather than trusting the browser's `Max-Age`. A
missing, altered or expired cookie reads as None. The value is signed, not
encrypted, so a user id belongs there and a secret does not, and nothing signed
this way can be revoked before it expires. Where session state lives, and
whether any exists, stays the application's: the cookie carries a string.

**HEAD is refused with a 501 and no body**, like any verb `Http.app` does not
implement, and `Http.Verb.Head` is gone. It used to reach the routes and match
none of them. The refusal carries no body because waitress writes whatever body
it is handed even for a HEAD, which a client keeping the connection open reads
as its next response.

**Every HTML response carries `Content-Security-Policy: frame-ancestors
'self'`**, so another site cannot frame a page and collect a click meant for it.
A route that must be framed sends a policy of its own, which is kept. JSON,
streams and files that are not HTML carry none.

**`Response.file(root, name, disposition)` serves a file under a directory.**
`name` is the relative path a client sent. An empty or absolute name, a `..`
segment, a symlink out of `root`, a directory and a missing file are all the
same 404. The type is guessed from the name, with `; charset=utf-8` added to
text, JSON and JavaScript so a browser never guesses a page's encoding.
`Content-Disposition` names the file in ASCII and UTF-8, and the response is
revalidated.

**`Response.revalidated` lets the browser keep a response**, and `Http.app`
answers 304 with no body when it already has it. Every builder sends
`Cache-Control: no-store`, which is right for an agent's reply and wrong for a
stylesheet, and a page reading its assets from disk per request was re-sending
them on every load. Wrapping any complete response, HTML included, adds a
content-derived `ETag` and `Cache-Control: private, no-cache`. The route still
runs on every load and a 304 means the body is byte-for-byte unchanged, so a copy
is never stale and never another user's. Editing a file takes effect with no
restart, while an unchanged one costs a conditional request and no body at all.

The templates pin the previous release and still call the old signatures.
Moving them is part of the release, not of this change.

The journal viewer is now something a driver mounts, not a second process you
start. `harpe.observability.ViewLogger` is a `Logger` that retains the last
`capacity` entries in memory and lets them be read back, which gives a
write-only channel a read side, and `harpe.logging.TeeLogger` puts it beside the
durable backend a driver already had rather than in front of it.
`harpe.observability.Viewer` serves that window as one route — `Viewer.respond`
answers with the self-contained page, or with the entries after the cursor the
page polls it back with — so an agent already serving HTTP mounts it at a path
of its own choosing, and one that is not takes `Viewer.start` to bind a port on
a daemon thread. The cursor and envelope stay between the page and the viewer.
An entry is visible the moment it is logged — no flush, no file path to agree
on, no `jo run view` in another terminal.

**`Model.Usage` is now `harpe.metering.Usage`, and it is a record rather than two
counts.** It carries the `provider` and `model` that were asked and the
`cacheReadTokens` / `cacheWriteTokens` that break `inputTokens` down, alongside
the totals it had, so everything a charge is computed from is in one value — no
joining a log record back to whichever model object happened to be in scope. An
adapter states the facts once and passes the value to both `Reply` and
`harpe.models.logReplied`, which takes a `Usage` rather than six loose
arguments.

**The class owns its record.** `Usage.event` is the name it is logged under,
and `Usage.encode` / `Usage.decode` are the two halves of its codec, in one file
with the class — the arrangement `TurnLog` already used, for the reason it
gives: two hand-written halves that agree only by inspection is how a renamed
key silently costs a reader every record. A driver billing off a stored journal
reads `Usage.decode(entry)` rather than picking six keys out of a dict, so a
counter added later arrives as a field on the value rather than as a key to
learn about. A `Context` still sizes itself on `inputTokens` alone.

The provider's own log events are `harpe.models.ModelLog` — `repliedEvent`,
`failedEvent`, `logReplied`, `logFailed` — a section rather than four loose
`private[harpe]` functions, named for the records it owns the way
`harpe.turns.TurnLog` is. `usageInt` moved to the adapters' `Util`, which is
package-private, since reading a counter off a provider's response is not a
logging concern.

`Logger.logFields(event, fields)` writes a record whose fields are already a
`Map[String, Value]`, which is what a codec has. `log` is now the pair-taking
front door over it, and `TurnLog` and `Usage` stopped assembling an `Entry` by
hand to stamp the time themselves.

**The counts have moved to `harpe.metering.usage`, their own event.**
`harpe.model.replied` keeps `provider` and `model` and says only that an attempt
succeeded — `startswith("harpe.model")` still reads the whole story of a
request, and the record a person reads while debugging is now free to grow a
field without changing the shape an invoice is computed from. Every call you pay
for in tokens writes one `harpe.metering.usage`: a model reply writes it beside
its attempt record, and so does anything else counted the same way — an
embedding, a reranker. Work charged by some other unit takes a name of its own
rather than this one, since a record with no `model` and no tokens is a second
shape under one name. A biller reading `harpe.model.replied` for tokens must
move to the new event; the fields themselves are unchanged.

The package is new: `harpe.metering`. `Usage` belongs to neither the model
interface that carries it, the adapters that produce it, nor the driver that
charges for it — and it is named for what harpe does, which is count what a call
consumed. Pricing it is the driver's, built on top.

`harpe.transcript.serve` and the `[module.view]` block every agent declared to
link it are gone with it. A journal that outlives its process is still a JSONL
file and still `jq`'s job.

`SerialLogger` is gone, and a `Logger` backend is now thread safe by contract.
It was installed only by `Logging.withLogger`, and a driver that binds the
`logger` channel directly — as the CLI agent does — never got it, so the promise
that "backends need not be thread-safe" was already false where a turn's tools
log concurrently. The guarantee moves to the backends, which is where the
knowledge is: `JsonlLogger` locks its file, `ViewLogger` its window, and
`NullLogger`, `TeeLogger` and `ContextLogger` own no state to protect.

That also retires a deadlock. `SerialLogger` held its lock across the wrapped
backend's `logEntry`, so a backend that raised once — a third-party one, which
the docs invite — never released it and every later `log` call blocked forever.
The same shape is fixed in `BrokerApprovals`, which held its lock across a broker
round trip, and in `runCode`, which could fail in `mkdtemp` while holding a
semaphore permit and retire it for the life of the process.

**A scope is now a string, not a `Value`.** `Entry.context` is `List[String]`
and `Logging.withContext` takes one scope string, by convention
`"<dotted key>=<id>"` — `"harpe.turn.id=209b1e14"`, `"harpe.tools.call=call_678b92"`.
What a reader does with context is tell one unit of work from another, which
needs the scope to be an identity; making it a string is what stops a producer
supplying something that is not one. Detail about the unit belongs in the fields
of the records under it, where it is queryable: the tool-call scope carries the
call id and no longer the tool name, which those records already name.

Downstream this deletes rather than simplifies — the viewer's scope-comparison
and label-derivation helpers both collapse to identity, and `jq` gets
`select(.context | index("myapp.session=alpha"))`.

BREAKING, with no migration: journals written before this carry object scopes,
so they will not resume and their scopes render as raw JSON in the viewer.

The page groups by structure alone. A record's `context` is its scope chain
innermost-first, so reversed it is the path from the root, and a lane is a path
prefix: the leftmost is every record in arrival order, and clicking a scope opens
a lane holding that scope and everything nested under it — `all › session › turn
› tool call`. No event name, no scope key and no record's position decides what a
lane contains, so a producer can invent scopes and they nest correctly without
the viewer learning about them. Concurrent conversations are handled by narrowing
and nesting by drilling, so neither needs a rule.

Opening a context never closes another: the lanes are a tree laid out as a grid,
a branch to a row and a depth to a column, with the root spanning them all.
Drilling grows a row rightward and opening something off that path starts a row
below it, so two deep contexts — one session's turn beside another's — stay
comparable. Re-clicking a context that is already open highlights it instead.

That replaces the turn cards, their outcome badges, and the bracket pairing
behind them. What remains of content knowledge is presentation that falls back —
a message renders as speech, anything else as its fields — and none of it decides
where a record goes. The viewer is therefore useful against any journal whose
records carry scopes, not only an agent's.

Following keeps its place. A render replaces the whole grid, so each lane's
scroll position was lost every poll and `follow` re-pinned all of them to the
end — a lane scrolled back through was dragged to the bottom a second later, and
a lane opened by drilling showed the end of that context rather than its start.
Positions now survive a render: a lane resumes following only once it is back at
the end, and a newly opened lane begins at the start of the context asked for.

A field whose value is a tree renders as a tree rather than as JSON text: a line
per entry, indented by depth, each branch showing what it holds (`{4}`, `[2]`)
and opening on demand. Pretty-printed JSON gave a small map and a deep tree the
same shape and turned one nested field into thirty lines of braces. Clipping is
now measured on the text a reader sees rather than on the markup, which had been
truncating records that fit — a `runCode` record of 496 rendered characters was
being cut because its markup ran to 942.

Every row carries a `{...}` button, revealed on hover, that opens the record as
the server sent it together with the path it sits at — which is the whole of what
decides the lanes it appears in.

`harpe.observability.test` serves a seeded journal for looking at the viewer by
hand — a plain exchange, two interleaved sessions, and a lane of deliberate
extremes — reached by a module declaring no sources of its own, which is what
`jo run viewer` is here. It drives `Journal`, `TurnLog` and `Logging.withContext`
rather than writing JSON, so the seed cannot drift from the format.

A record's `context` is now stored OUTERMOST FIRST — it is the path from the
root, written the direction paths are written, so the stored order is the order
the lanes and chips read in. `ContextLogger` prepends where it appended, and
`TurnLog.innerTurn`/`outerTurn` swap ends. Journals written before this have
their context reversed.

The framework binds nothing on its own: whether to expose a journal, where, and
to whom is the driver's call, since the page has no authentication and carries
whole conversations. The CLI agent serves it only when `JOURNAL_PORT` is set,
and builds the tee only then, so an unwatched run keeps no second copy.

The CLI agent's `runBash` records what it ran: `harpe.tools.runBash.ran` carries
the `command`, `exitCode`, `runSeconds` and `output`, and
`harpe.tools.runBash.timedOut` the `command` and the cap that stopped it. It is
the least confined thing the agent can do and it was logging nothing, so a shell
command was only ever prose inside a tool result. A command the user refused
still records nothing, because nothing ran.

**Templates**: `templates/` still pins the previous release, so `web` and
`telegram` keep their `[module.view]` block for now. Retargeting them (RELEASE.md
step 8) means dropping that block, teeing each session's `JsonlLogger` with a
`ViewLogger`, and mounting the two routes behind a switch of the driver's own.

The agent templates come back from `typescope/agents`, with that repository's
history, and live under `templates/`. `jo-templates.jsonl` at the root names
them, so `jo new --template typescope/harpe:web` replaces
`typescope/agents:web`.

They keep the pin that made the split worth making: every manifest under
`templates/` resolves a published release rather than the sources beside it, so
an API change on `main` still does not have to be made in five applications at
once. What goes away is the two-repository tax — an agent and the tutorial that
documents it now change in one pull request, and `cli/` is no longer mirrored
across a repository boundary at each release.

`cli` is no longer offered as a template. It stays in `cli/`, built from these
sources, as the framework's end-to-end test subject, and its tutorial is
removed. That leaves five.

`smart-logistics` is not among them. It lives in
[typescope/smart-logistics](https://github.com/typescope/smart-logistics),
carrying the history it had here, and is cloned rather than created with `jo
new`, so `typescope/harpe:smart-logistics` is no longer a template ref. Its case
study stays in these docs.

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
