+++
title = "Build Your First Agent"
+++

## Create the project

```sh
jo new my-agent --template typescope/harpe:hello
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` in `.env`.
OpenRouter also requires `MODEL`.

## Run it

```sh
jo start
```

`jo start` builds the sandbox and launches the application:

```text
Ask the agent something. Type 'quit' to stop.

You ▸ Find the prime numbers below 20.
Agent ▸ The primes below 20 are 2, 3, 5, 7, 11, 13, 17.
```

## Inspect the application

The project contains:

```text
my-agent/
  jo.toml
  AGENT.md
  src/
    Main.jo
  sandbox/
    jo.toml
    SandboxAPI.jo
    SandboxRuntime.jo
    Task.jo
```

Open `src/Main.jo`. It assembles the entire agent:

```jo
val runCode = runCodeTool(workspace.sandboxDir, approvalDeadline = 610.0)

val agent = new Agent:
  brain = Defaults.model()
  tools = [runCode]
  context = new FullContext:
    baseSystem = workspace.read("AGENT.md").getOrElse("")
    memory = new Memory
    initial = []

// What runs when the model calls a tool, wired by name.
val routes = Routes.of: runCode.name, (i: ToolInput) => runCode.run(i["code"])
```

The agent is offered one tool spec, and `routes` says what happens when the model
calls it. The rest of the file reads terminal input, passes it to
`agent.runTurn` along with the routes, and prints the answer.

`SimpleInteract` implements the interface through which the engine reports turn
events and asks whether a turn was cancelled:

```jo
private class SimpleInteract
  view Interact

  def cancelled: Bool = false

  def pause(seconds: Float): Bool =
    py.module("time").sleep(py.dynamic(seconds))
    false

  def approve(id: String, request: ApprovalRequest): ApprovalDecision =
    ApprovalCancelled

  def emit(event: harpe.turns.TurnEvent): Unit = pass
end
```

This implementation ignores events, never cancels a turn, and does not approve
consequential operations.

## Inspect the sandbox

`sandbox/SandboxAPI.jo` is the complete contract visible to model-written
programs:

```jo
namespace sandbox.api

import jo.IO.stdout

defer def runTask(): Unit receives stdout
```

The only granted capability is `stdout`. A generated program can calculate and
print, but it cannot access ambient files, the network, or a shell. If it names
an unavailable capability, compilation fails before anything runs.

`SandboxRuntime.jo` is trusted application code. It supplies the capabilities
declared by the API. `Task.jo` is the build-time placeholder that proves the
sandbox links. For each real tool call, `runCode` compiles the LLM-generated
program in a temporary directory without modifying your project file.

This API/runtime/guest dependency boundary is Harpe's core security mechanism.
The [sandbox concept guide](/concepts/sandbox/) explains the compiler guarantee.

## Build a complete application

- [Create a CLI agent](/tutorial/create-cli-agent/) — terminal history,
  cancellation, memory, skills, and audit logs.
- [Create a web agent](/tutorial/create-web-agent/) — browser sessions,
  streaming, uploads, and downloadable files.
- [Create a Telegram agent](/tutorial/create-telegram-agent/) — persistent bot
  sessions, authorization, attachments, and Telegram rendering.
- [Create a custom capability](/tutorial/create-custom-capabilities/) — give
  model-written programs narrowly typed access to your own systems.
