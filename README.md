# Harpe (prototype)

A reusable agent framework for Jo. An agent is an LLM that acts **only** by
writing Jo programs, compiled against a typed capability sandbox and run each
turn. This prototype covers **CLI (conversational) agents**.

## Layout

```
harpe/                   # the `harpe` framework package: the loop + reusable cap impls
  jo.toml                #   name = "harpe", runtime = python, dep harpe-caps
  src/
    Harpe.jo             #   Harpe.cli — the LLM↔program chat loop
    HarpeCapsRuntime.jo  #   reusable capability impls: SkillsImpl, LoggerImpl
    os.jo  subprocess.jo
  caps/                  # `harpe-caps`: reusable capability interfaces (Skills, Logger) + types
  example/               # an example AGENT that depends on the framework
    jo.toml              #   the agent app: jo.main = Harpe.cli
    AGENT.md  skills/  .env.example
    sandbox/
      api/               #   sandbox-api: the runTask contract (imports HarpeCaps)
      runtime/           #   sandbox-runtime: SandboxRuntime.main builds caps + calls runTask
      guest/             #   sandbox-guest: the model's per-turn program
```

The framework (`harpe` + `harpe-caps`) owns the **loop** and the **reusable
capabilities**; it does **not** own `runTask` or the per-turn entry. Each agent
owns its `sandbox/`: `api` declares `runTask`, `runtime` has its own `main`
(`Runtime.main`) where `jo.main` is rewired, and `guest` is what the LLM writes.

## How an agent is wired

The agent app links its `main` to the framework loop:

```toml
# example/jo.toml
[main.dependencies]
harpe = { path = ".." }
[main.links]
"jo.main" = "Harpe.cli"
```

The guest is the per-turn program. It depends on the agent's `api` (check) and
`runtime` (link), and rewires the entry to the agent's own `Runtime.main`:

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
reusing Harpe's `SkillsImpl` / `LoggerImpl` — and calls `runTask`. Granting more
is just widening `runTask`'s `receives` in `api` and instantiating the impl in
`runtime`. (Namespaces follow the sandbox roles: `SandboxAPI`, `SandboxRuntime`,
and the guest's `UserTask`.)

## The turn loop (`Harpe.cli`)

1. read a line from the user
2. ask the LLM, offering one tool: `runCode(code)` — the prompt embeds the
   agent's `sandbox/api` contract so the LLM writes against it
3. on a `runCode` call: write the program to `sandbox/guest/src/Task.jo`, build
   & run it with `jo run --spec sandbox/guest/jo.toml -- skills`, and feed the
   program's stdout (or the compile error) back to the LLM
4. repeat until the LLM replies with text, then print the reply

The compile step is the security checkpoint: a program that names a capability
the agent didn't grant fails to compile, so it never runs.

## Run the example

```sh
pip install anthropic                  # the loop calls the SDK via Jo's py FFI
cd example
cp .env.example .env                   # set ANTHROPIC_API_KEY (and MODEL)
jo run                                  # chat in your terminal
```

## Status / next

Working and verified: the framework packages build; the example agent builds;
the loop runs and the per-turn build+run pipeline works (`ready`).

Next increments:
- **More reusable capabilities** — `FS` alongside `Skills` / `Logger`.
- **Custom capabilities** — an agent adds an interface to its `sandbox/api` and
  an impl to its `sandbox/runtime`, and widens `runTask`'s `receives`; the loop
  already reads `sandbox/api` into the prompt, so the LLM sees the new contract.
- request-driven / monitoring triggers; audit log to `logs/`; sessions under
  `data/`; confirmation for irreversible actions; polish (clean exit on missing
  key, spinner, markdown rendering).
```
