# Harpe

An agent framework for Jo. A Harpe agent is an LLM that acts **only** by
writing Jo programs, compiled against a typed capability sandbox and run each
turn. The compile step is the security checkpoint: a program that names a
capability you didn't grant fails to compile, so it never runs.

Harpe ships as a **core library plus three runnable agents** — terminal
(`cli/`), browser (`web/`), and Telegram (`telegram/`). Each agent directory
carries both its driver code and its identity (`AGENT.md`, `skills/`,
`sandbox/`, assets). **To make your own agent, copy one and edit it.**

## Quick start

```sh
cd cli                        # or web/, or telegram/
pip install -r requirements.txt
cp .env.example .env          # set ANTHROPIC_API_KEY (or PROVIDER=openai + OPENAI_API_KEY)
jo start                      # builds the sandbox guest, then launches the agent
```

- **cli** — chat in your terminal (ESC interrupts a running turn).
- **web** — open `http://127.0.0.1:8765` (`HOST`/`PORT` to change). Sessions
  live at `/c/<id>` and resume across restarts.
- **telegram** — also set `TELEGRAM_BOT_TOKEN` (from @BotFather) and
  `TELEGRAM_ALLOWED_SENDERS` (comma-separated numeric user ids; access is
  closed by default — an unlisted sender is told their id in a private chat).
  No public endpoint needed: the bot long-polls.

`jo start` is the `[commands]` entry in the agent's `jo.toml`:
`jo build --spec sandbox/guest/jo.toml && jo run` — build the sandbox the model
compiles against, then run the agent. (Requires Jo 0.11.3+.)

## Layout

```
harpe/
  agent/                 # `harpe`: the core library — one file per abstraction
    src/
      Agent.jo           #   Agent (brain + tools + context + budget) + the turn engine
      Model.jo           #   Model interface + the conversation model (Message, …)
      Tool.jo            #   Tool abstraction (typed params, ToolInput, RunOutcome)
      Context.jo         #   Context interface — pluggable context engineering
      Memory.jo          #   the agent-curated working-memory store
      SessionLog.jo      #   the append-only transcript archive (audit)
      Workspace.jo       #   the agent working dir (context param)
      Interact.jo        #   `harpe.turn`: how a turn is driven/observed
      models/            #   `harpe.models`: anthropic / openai / echo
      tools/             #   `harpe.tools`: runCode, skill tools, memory tools
      context/           #   `harpe.context`: WindowedContext, SummarizingContext
      ffi/, util.jo      #   Python interop; transcript windowing
  sandbox/               # `harpe-sandbox`: the Sandbox host-side abstraction
  cli/  web/  telegram/  # the three runnable agents (see Quick start)
```

Each agent directory contains:

```
  jo.toml                # deps harpe; links jo.main to its driver; `start` command
  AGENT.md               # the system prompt, used verbatim
  skills/                # read-only reference files the agent can browse
  sandbox/
    api/                 # declares runTask — the granted capabilities
    runtime/             # builds Sandbox + capability impls, calls runTask
    guest/               # the model's per-turn program (rewritten by runCode)
  src/                   # the driver (Cli.jo / Server.jo / Telegram.jo, Config.jo, …)
  assets/index.html      # web only: the chat page, served from disk — edit it live
```

## How a turn works

An **`Agent`** bundles what thinks, what it can do, what it sees, and its turn
policy:

```
class Agent(brain: Model, tools: List[Tool], context: Context, maxToolRounds: Int)
  def runTurn(maxRetries: Int, interact: Interact): TurnResult
```

`runTurn` asks the model, runs the tool calls it makes, and repeats until the
model answers in plain text. Transient model errors retry with backoff; after
`maxToolRounds` tool rounds the model is asked once more with no tools, forcing
a final answer. The driver implements `Interact` (how the model call is issued
and cancelled, how progress is shown) and owns sessions and persistence.

The default toolset is `runCode` (write, compile, and run a Jo program in the
sandbox), three read-only skill tools (`skillsList` / `skillsRead` /
`skillsSearch`), and three memory tools (below). Large tool outputs are elided
to a bounded excerpt; the full output is logged to `logs/runs.jsonl`.

## Context and memory

What the model sees each request is composed by the agent's **`Context`** — a
per-session value and the framework's only context-engineering surface:

```
interface Context
  def append(message: Message): Unit                       // record a transcript event
  def render(interact: Interact): String ~ List[Message]   // compose this request
  def mark(): Unit                                         // turn start (for rollback)
  def rollback(): Unit                                     // drop since mark
end
```

Two strategies ship, named by their transcript policy:

- **`WindowedContext`** (default): system = `AGENT.md` + a volatile memory
  block; messages = a sliding window of recent turns (~24k chars, whole turns).
- **`SummarizingContext`**: old turns are distilled into a rolling summary by an
  extra model call (its own `distiller` model — can be a cheaper one) instead of
  dropped, triggered by high/low water marks.

**Memory** is a string→string map the *LLM itself* curates via `updateMemory` /
`readMemory` / `listMemory`; it is rendered into every request and persists per
session (`<id>.memory.json`, written at turn commit). Which keys to keep is
steered by your `AGENT.md`, not by the framework. The full transcript is always
archived as append-only JSONL under `logs/` for audit — context is constructed,
never replayed wholesale. Design notes: `context.md`.

## Make it yours

Copy an agent directory, then:

**Prompt and knowledge.** Edit `AGENT.md` (used verbatim as the stable system
prompt) and drop reference files into `skills/` — the agent browses them with
the read-only skill tools.

**Grant capabilities (the usual path).** Give the *LLM* a new typed ability
inside the sandbox: declare the capability in `sandbox/api`, widen `runTask`'s
`receives`, and construct the implementation in `sandbox/runtime` (impls get the
`Sandbox` for logging/env/resource caps — never the model). Ungranted abilities
fail to compile in the model's code.

**Add host tools (advanced).** Tools run in the loop process, *outside* the
sandbox, so keep them narrow. A tool is data plus a handler — typed parameters,
no hand-written JSON schema:

```jo
def textLength(): Tool =
  Tool:
    "textLength"
    "Return the number of characters in a string."
    [strParam("text", "The text to measure")]
    input =>
      val n = input.string("text").size
      new RunOutcome("\{n}", "measured · \{n} chars")
```

Offer it by editing the toolset line in your agent's `Config.agent`:

```jo
val tools = Defaults.tools() ++ memoryTools(memory) ++ [textLength()]
```

`Config.jo` is the agent's whole configuration surface — plain functions,
centered on `agent(brain, memory, initial)`: the per-session assembly of the
base prompt (from `AGENT.md`), the toolset (base tools + the session's memory
tools), the context strategy, and the turn budget. It is *this* agent's
configuration, not framework code, so it assumes freely — edit it to change any
of those (an agent with different assumptions, e.g. a sub-agent, constructs
`Agent` directly). Around it sit `model()`, the knobs (`maxToolRounds`,
`maxRetries`), and driver-specific settings (web session idle time, Telegram
allowlist). The common cases delegate to the shared `harpe.Defaults` (base
tools, env-selected model, name extraction). There are no registration hooks: to
change behavior, change the code.

**Choose the model.** `harpe.Model` is provider-agnostic; `Defaults.model()`
selects by env:

| `PROVIDER`            | Key                 | `MODEL` default   | Extra                       |
|-----------------------|---------------------|-------------------|-----------------------------|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-opus-4-6` | —                           |
| `openai`              | `OPENAI_API_KEY`    | `gpt-4o`          | `OPENAI_BASE_URL` (optional — Groq, llama.cpp, …) |

Or edit `Config.model()` to return any `Model` — `harpe.models.echo()` is a
keyless dummy for wiring tests. A new provider is one file: a class that
`view Model` plus a factory.

**Restyle the web page.** `web/assets/index.html` is a plain self-contained
page, served from disk and read per request — edits show on browser refresh, no
rebuild.

## How the sandbox is wired

The model's per-turn program (`sandbox/guest`) depends on your `api` and
`runtime`, and links the entry to your runtime:

```toml
# sandbox/guest/jo.toml
[main.dependencies]
sandbox-api     = { path = "../api" }
sandbox-runtime = { path = "../runtime", link = true }
[main.links]
"jo.main"            = "SandboxRuntime.main"
"SandboxAPI.runTask" = "UserTask.runTask"
```

`SandboxRuntime.main` builds the host-side `Sandbox`, constructs the granted
capability impls, sets resource caps (`limitMemoryMb` / `limitCpuSeconds` —
irreversible; the model's code cannot raise them), and calls `runTask`. On each
`runCode` the driver writes the program to `sandbox/guest/src/Task.jo`, builds
it, runs it under a wall-clock timeout (process-group kill), and feeds stdout —
or the compile/timeout error — back to the model.

## Development

The core library has a pure test suite (no network, no tty):

```sh
cd agent && jo test
```

## Status / next

Working: all three agents, the sandbox pipeline, retries/budgets, bounded tool
results, per-session memory with persistence and resume (web/Telegram), and the
pluggable `Context` layer with windowing and summarizing strategies.

Next: streaming + token/usage accounting (calibrate context budgets with real
tokens); more `Sandbox` facilities (agent↔sandbox messaging) and reusable
capabilities (e.g. a typed `FS`); CLI session resume; confirmation for
irreversible actions.
