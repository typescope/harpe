# Harpe (prototype)

A reusable agent framework for Jo. An agent is an LLM that acts **only** by
writing Jo programs, compiled against a typed capability sandbox and run each
turn. This prototype covers **CLI**, **web (browser)**, and **Telegram**
conversational agents.

## Layout

```
harpe/                   # a workspace: three framework packages + an example agent
  agent/                 # `harpe`: the shared base (runtime = python)
    jo.toml
    src/
      Workspace.jo       #   `harpe`:        the agent working dir (context param)
      ffi/               #   `harpe.ffi` + `os`: Python interop
        FFI.jo           #     module handles + helpers (`harpe.ffi`)
        os.jo            #     the `os` namespace
      models/            #   `harpe.models`: the provider-agnostic Model layer
        Model.jo         #     the Model interface + Jo conversation model
        Anthropic.jo     #     the Anthropic-backed Model (`anthropic`)
        OpenAI.jo        #     an OpenAI-compatible Model (`openai`)
        Echo.jo          #     a dummy Model for tests (`echo`)
      tools/             #   `harpe.tools`:  the reusable tools layer
        Tool.jo          #     the Jo-modeled Tool abstraction (+ RunOutcome)
        RunCode.jo       #     the runCode tool (+ runCodeTool builder)
        Skills.jo        #     the read-only skill tools (+ skillTools builder)
  sandbox/               # `harpe-sandbox`: the `Sandbox` abstraction (`harpe.sandbox`)
    jo.toml              #   self-contained (no deps)
    src/Sandbox.jo       #   Sandbox interface + factory (impl hidden)
  cli/                   # `harpe-cli`: the conversational loop (`harpe.cli`)
    jo.toml              #   dep harpe (../agent)
    src/Harpe.jo         #   the chat loop + main entry + defer hooks (default/extraTools)
  web/                   # `harpe-web`: the same loop, served in a browser (`harpe.web`)
    jo.toml              #   dep harpe (../agent)
    src/Web.jo           #   main entry: starts a local HTTP server
    src/Server.jo        #   WSGI routing + the turn-running ChatServer
    src/WebInteract.jo   #   Interact impl: streams TurnEvents as NDJSON to the page
    src/Assets.jo        #   the self-contained chat page (markup + styles + script)
    src/Config.jo        #   defer hooks (model/tools/bounds), keyed `harpe.web.*`
  telegram/              # `harpe-telegram`: the same loop, over a Telegram bot (`harpe.telegram`)
    jo.toml              #   dep harpe (../agent)
    src/Telegram.jo      #   main entry: long-poll loop + the turn-running TelegramBot
    src/TelegramClient.jo#   the Bot API client (getUpdates / sendMessage / typing)
    src/TelegramInteract.jo# Interact impl: surfaces a "typing" action while working
    src/Sessions.jo      #   session-per-chat-id storage layout
    src/Config.jo        #   defer hooks + bot token + chat-id allowlist, keyed `harpe.telegram.*`
  example/               # an example CLI AGENT that depends on the framework
    jo.toml              #   the agent app: jo.main = harpe.cli.main
    AGENT.md             #   the system prompt (used verbatim)
    skills/
    .env.example
    sandbox/
      api/               #   sandbox-api: the runTask contract (the granted capabilities)
      runtime/           #   sandbox-runtime: SandboxRuntime.main builds Sandbox + calls runTask
      guest/             #   sandbox-guest: the model's per-turn program
  example-web/           # the same agent, served in the browser (jo.main = harpe.web.main)
    jo.toml              #   links harpe.web.Config.model to the keyless echo model
    src/WebExample.jo    #   the echo-model override (drop the link to use Anthropic)
  example-telegram/      # the same agent, over a Telegram bot (jo.main = harpe.telegram.main)
    jo.toml              #   links harpe.telegram.Config.model to the keyless echo model
    .env.example         #   TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_CHAT_IDS
    src/TelegramExample.jo#  the echo-model override (drop the link to use Anthropic)
```

The web agent reuses the entire engine unchanged — `harpe.turn`, `harpe.models`,
`harpe.tools`, `Workspace`, `SessionLog`. Only the driver differs: `harpe.web`
serves a browser chat over HTTP and implements `Interact` by streaming each
`TurnEvent` as one NDJSON line, so the page shows live progress (the browser
counterpart of the CLI spinner). Switching an agent from terminal to browser is
one line — `jo.main = harpe.web.main`. Run `example-web/` with `jo run` and open
`http://127.0.0.1:8765`.

The Telegram agent reuses the same engine, and needs no public endpoint: instead
of a webhook it *long-polls* the Bot API (`getUpdates`), so nothing has to be
reachable from the internet — a plain `jo run` on your machine works. Each chat
is a session keyed by its `chat.id` (resumed from disk on the next message), and
`TelegramInteract` shows a "typing…" action while the model or a tool works (the
Telegram counterpart of the CLI spinner / web NDJSON stream). Because a bot is
publicly reachable and the agent runs code, access is closed by default: only
chat ids in `TELEGRAM_ALLOWED_CHAT_IDS` are served, and an unlisted chat is told
its own id so the operator can add it. Switching an agent to Telegram is again
one line — `jo.main = harpe.telegram.main`. Run `example-telegram/` with a
`TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather) in `.env`.

The framework is three packages. `harpe` (in `agent/`) is the shared base: the
`harpe.ffi` interop and the `harpe.tools` layer (the `Tool` abstraction +
`runCode`/skill tools). `harpe-sandbox` is a self-contained foundational package
providing the `Sandbox` abstraction — host-side facilities (logging, env, future
agent↔sandbox comms) for the sandbox runtime and capability implementations,
**never** the LLM. `harpe-cli` is one agent type — the conversational loop
(`harpe.cli`). None of them owns `runTask` or the per-turn entry — each agent owns
its `sandbox/`: `api` declares `runTask`, `runtime` has its own `main`
(`SandboxRuntime.main`) where `jo.main` is rewired, and `guest` is what the LLM
writes.

## How an agent is wired

The agent app links its `main` to the loop package:

```toml
# example/jo.toml
[main.dependencies]
harpe-cli = { path = "../cli" }
[main.links]
"jo.main" = "harpe.cli.main"
```

The guest is the per-turn program. It depends on the agent's `api` (check) and
`runtime` (link), and rewires the entry to the agent's own `SandboxRuntime.main`:

```toml
# example/sandbox/guest/jo.toml
[main.dependencies]
sandbox-api     = { path = "../api" }
sandbox-runtime = { path = "../runtime", link = true }
[main.links]
"jo.main"            = "SandboxRuntime.main"
"SandboxAPI.runTask" = "UserTask.runTask"
```

`SandboxRuntime.main` (in `sandbox/runtime`) builds the host-side `Sandbox`,
constructs the granted capability implementations (passing them the `Sandbox`),
and calls `runTask`. The `Sandbox` gives impls logging / env / resource caps
(`limitMemoryMb`, `limitCpuSeconds`) / (future) comms but is **never** passed to
`runTask`, so the model can't name it. Setting the caps before `runTask` is how
an agent bounds the guest's memory and CPU from inside the runtime — irreversible
limits the model's own code cannot raise. (Namespaces follow
the sandbox roles: `SandboxAPI`, `SandboxRuntime`, and the guest's `UserTask`.)

## Extending an agent: capabilities vs. tools

There are two ways to give an agent more power, and they are not the same:

- **Capabilities (the usual path).** Grant the *LLM* a new typed ability inside
  the sandbox: declare a capability interface, widen `runTask`'s `receives` in
  `sandbox/api`, and construct its implementation in `sandbox/runtime` (the impl
  gets the `Sandbox` for logging/env/comms). The model invokes it from the Jo it
  writes, and the compile-time check keeps ungranted abilities unreachable.
- **Tools (advanced).** Change the *host-side* tools the loop offers the model
  (`runCode`, the skill tools, …). These run outside the sandbox, so reach for
  them rarely — see "Defining and customizing tools" below.

## The turn loop (`harpe.cli`)

1. read a line from the user
2. ask the LLM with the agent's `AGENT.md` as the system prompt (verbatim), and
   `runCode(code)` plus three read-only reference tools over the skills dir —
   `skillsList()`, `skillsRead(name)`, `skillsSearch(query)`. The model learns
   each tool from the `tools=` API, so the prompt needn't describe them. The skill
   tools only let it read its own knowledge files; it still *acts* only via
   `runCode`
3. on a `runCode` call: write the program to `sandbox/guest/src/Task.jo`, build
   it with `jo build --spec sandbox/guest/jo.toml`, run the compiled program
   under a wall-clock timeout (a stuck build or infinite loop is killed —
   process group and all), and feed its stdout (or the compile/timeout error)
   back to the LLM
4. repeat until the LLM replies with text, then print the reply

The compile step is the security checkpoint: a program that names a capability
the agent didn't grant fails to compile, so it never runs.

The loop is bounded and resilient: a transient model error (rate limit, 5xx,
connection blip) is retried with exponential backoff (`maxRetries`), and each
turn is capped at `maxToolRounds` tool-call rounds — once spent, the model is
asked once more with no tools, forcing a final answer. Both are `defer def`
hooks an agent can override through its `jo.toml`.

## Defining and customizing tools

A tool is a `harpe.tools.Tool` (`harpe/src/tools/Tool.jo`): a name, a description,
typed parameters, and a host-side handler. Parameters are modeled in Jo
(`ParamType` / `ToolParam`) — the `spec` method derives the Anthropic JSON schema,
and handlers read arguments via a typed `ToolInput`, so tool authors never
hand-write JSON:

```scala
Tool:
  "textLength"
  "Return the number of characters in a string."
  [strParam("text", "The text to measure")]
  input =>
    val n = input.string("text").size
    new RunOutcome("\{n}", "measured · \{n} chars")
```

The toolset offered to the model is `defaultTools() ++ extraTools()`. Both are
`defer def` hooks in `harpe.cli` with sensible defaults, so an agent customizes
the toolset **purely through its `jo.toml`** — the same compile-time linking that
wires `jo.main` and the sandbox's `runTask`, no custom `main` required:

```toml
# my-agent/jo.toml
[main.dependencies]
harpe-cli = { path = "../cli" }
[main.links]
"jo.main"              = "harpe.cli.main"
"harpe.cli.extraTools" = "MyAgent.extraTools"   # ADD tools to the built-ins
# "harpe.cli.defaultTools" = "MyAgent.allTools" # or REPLACE the base set entirely
```

```jo
// my-agent/src/MyAgent.jo
namespace MyAgent
import harpe.tools.*

// Add `receives workspace` (and `import harpe.workspace`) if your tools need to
// resolve paths against the agent's working directory.
def extraTools(): List[Tool] = [ /* your Tool values */ ]
```

`defaultTools` defaults to `runCode` + the read-only skill tools; overriding it
gives full control, including whether and how `runCode` exists. Compose with the
`runCodeTool` / `skillTools` builders in `harpe.tools`, or supply entirely custom
`Tool`s. A mismatched link signature is a compile-time error.

Host tools run in the loop process, outside the sandbox, so keep them narrow —
the typed sandbox (widening `runTask`'s `receives`) remains the place to grant
the model new ways to *act* on the world.

## Choosing the model

The chat model is a provider-agnostic `harpe.models.Model` — `reply(system,
history, tools)` returning the assistant's next message. The loop owns the
conversation (a Jo `List[Message]`) and runs the tools; each provider impl only
translates to/from its own wire format, so swapping providers touches nothing
else.

The default `model()` hook reads env vars to select a provider at runtime:

| `PROVIDER`    | Key needed          | `MODEL` default    | Extra vars             |
|---------------|---------------------|--------------------|------------------------|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-opus-4-6` | —                 |
| `openai`      | `OPENAI_API_KEY`    | `gpt-4o`           | `OPENAI_BASE_URL` (optional) |

`OPENAI_BASE_URL` lets you point the OpenAI provider at any compatible endpoint —
Groq, Together AI, a local llama.cpp server, etc. Leave it unset for the default
OpenAI API.

The hook itself is a `defer def` and can be replaced entirely through `jo.toml`:

```toml
[main.links]
"harpe.cli.model" = "harpe.models.echo"   # dummy model — test the cli, no API key
# "harpe.cli.model" = "MyAgent.model"     # or your own custom Model factory
```

`harpe.models.echo` replies with the last user message, so the whole loop can be
driven in a test without a provider or key. A new provider is one file: a class
that `view Model` plus a factory `def <name>(...): Model`.

## Run the example

```sh
cd example
pip install -r requirements.txt        # anthropic + openai; readline etc. are stdlib
cp .env.example .env                   # set ANTHROPIC_API_KEY (or OPENAI_API_KEY)
jo run                                  # chat in your terminal
```

To use OpenAI or a compatible endpoint instead of Anthropic:

```sh
# .env
PROVIDER=openai
OPENAI_API_KEY=sk-...
MODEL=gpt-4o
# OPENAI_BASE_URL=https://api.groq.com/openai/v1   # optional
```

## Status / next

Working and verified: the framework packages build; the example agent builds;
the loop runs and the per-turn build+run pipeline works (`ready`).

Robustness (done): host-side wall-clock timeout + process-group kill on the
guest build/run; in-guest memory/CPU caps via the `Sandbox` runtime
(`limitMemoryMb` / `limitCpuSeconds`); transient-error retries with backoff; a
per-turn tool-call budget.

Next increments:
- **Context-window management** — token budget + pluggable compaction
  (drop-oldest / summarize / tool-output elision) between the loop and the model.
- **Streaming + token/usage accounting** — widen the `Model` return; surface
  per-turn tokens/cost.
- **More `Sandbox` facilities** — agent↔sandbox messaging alongside logging/env.
- **Reusable capabilities** — e.g. an `FS` capability an agent can grant the LLM,
  with an impl backed by the `Sandbox`.
- request-driven / monitoring triggers; sessions under `data/` (resume/replay);
  confirmation for irreversible actions; polish (markdown rendering).
```
