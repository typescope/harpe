# Harpe (prototype)

A reusable agent framework for Jo. An agent is an LLM that acts **only** by
writing Jo programs, compiled against a typed capability sandbox and run each
turn. This prototype covers **CLI (conversational) agents**.

## Layout

```
harpe/                   # three framework packages + an example agent
  caps/                  # `harpe-caps`: reusable capability interfaces (Logger) + types
  jo.toml                # `harpe`: the shared framework (runtime = python, dep harpe-caps)
  src/
    ffi/FFI.jo           #   `harpe.ffi`:   shared Python interop
    tools/               #   `harpe.tools`: the reusable tools layer
      Tool.jo            #     the Jo-modeled Tool abstraction (+ RunOutcome)
      RunCode.jo         #     the runCode tool
      Skills.jo          #     the read-only skill tools
      Builtins.jo        #     default paths + builtinTools
    HarpeCapsRuntime.jo  #   `HarpeCapsRuntime`: LoggerImpl
    os.jo
  cli/                   # `harpe-cli`: the conversational loop (`harpe.cli`)
    jo.toml              #   dep harpe
    src/Harpe.jo         #   the chat loop + main entry + defer hooks (default/extraTools)
  example/               # an example AGENT that depends on the framework
    jo.toml              #   the agent app: jo.main = harpe.cli.main
    AGENT.md  skills/  .env.example
    sandbox/
      api/               #   sandbox-api: the runTask contract (imports HarpeCaps)
      runtime/           #   sandbox-runtime: SandboxRuntime.main builds caps + calls runTask
      guest/             #   sandbox-guest: the model's per-turn program
```

The framework is three packages. `harpe-caps` (interfaces) and `harpe` are the
reusable layers: `harpe` holds the shared `harpe.ffi` interop and the `harpe.tools`
layer (the `Tool` abstraction + `runCode`/skill tools), so any agent type can
reuse them. `harpe-cli` is one agent type — the conversational loop (`harpe.cli`),
which depends on `harpe`. None of them owns `runTask` or the per-turn entry —
each agent owns its `sandbox/`: `api` declares `runTask`, `runtime` has its own
`main` (`SandboxRuntime.main`) where `jo.main` is rewired, and `guest` is what
the LLM writes.

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
harpe-caps      = { path = "../../../caps" }
sandbox-api     = { path = "../api" }
sandbox-runtime = { path = "../runtime", link = true }
[main.links]
"jo.main"            = "SandboxRuntime.main"
"SandboxAPI.runTask" = "UserTask.runTask"
```

`SandboxRuntime.main` (in `sandbox/runtime`) builds the granted capabilities —
reusing Harpe's `LoggerImpl` — and calls `runTask`. Granting more
is just widening `runTask`'s `receives` in `api` and instantiating the impl in
`runtime`. (Namespaces follow the sandbox roles: `SandboxAPI`, `SandboxRuntime`,
and the guest's `UserTask`.)

## The turn loop (`harpe.cli`)

1. read a line from the user
2. ask the LLM, offering `runCode(code)` plus three read-only reference tools
   over the skills dir — `skillsList()`, `skillsRead(name)`, `skillsSearch(query)`
   — the prompt embeds the agent's `sandbox/api` contract so the LLM writes
   against it. The skill tools only let the model read its own knowledge files
   (any file type, named with their extension); it still *acts* only via `runCode`
3. on a `runCode` call: write the program to `sandbox/guest/src/Task.jo`, build
   it with `jo build --spec sandbox/guest/jo.toml`, run the compiled program, and
   feed its stdout (or the compile error) back to the LLM
4. repeat until the LLM replies with text, then print the reply

The compile step is the security checkpoint: a program that names a capability
the agent didn't grant fails to compile, so it never runs.

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

def extraTools(): List[Tool] = [ /* your Tool values */ ]
```

`defaultTools` defaults to `runCode` + the read-only skill tools (via
`builtinTools`); overriding it gives full control, including whether and how
`runCode` exists. Compose with the `runCodeTool` / `skillTools` / `builtinTools`
builders in `harpe.tools`, or supply entirely custom `Tool`s. A mismatched link
signature is a compile-time error.

Host tools run in the loop process, outside the sandbox, so keep them narrow —
the typed sandbox (widening `runTask`'s `receives`) remains the place to grant
the model new ways to *act* on the world.

## Run the example

```sh
cd example
pip install -r requirements.txt        # just `anthropic`; readline etc. are stdlib
cp .env.example .env                   # set ANTHROPIC_API_KEY (and MODEL)
jo run                                  # chat in your terminal
```

## Status / next

Working and verified: the framework packages build; the example agent builds;
the loop runs and the per-turn build+run pipeline works (`ready`).

Next increments:
- **More reusable capabilities** — `FS` alongside `Logger`.
- **Custom capabilities** — an agent adds an interface to its `sandbox/api` and
  an impl to its `sandbox/runtime`, and widens `runTask`'s `receives`; the loop
  already reads `sandbox/api` into the prompt, so the LLM sees the new contract.
- request-driven / monitoring triggers; audit log to `logs/`; sessions under
  `data/`; confirmation for irreversible actions; polish (clean exit on missing
  key, spinner, markdown rendering).
```
