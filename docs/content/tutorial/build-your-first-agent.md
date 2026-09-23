+++
title = "Build Your First Agent"
+++

## Install Jo

```sh
curl -sSf https://jo-lang.org/install.sh | sh
```

This installs the `jo` command used to create and run the agent.

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
  prompts/SYSTEM.md
  src/
    Main.jo
  skills/
    jo-syntax.md
  sandbox/
    jo.toml
    SandboxAPI.jo
    SandboxRuntime.jo
    Task.jo
```

Open `src/Main.jo`. It names the pieces a turn will be run with:

```jo
val runCode = RunCodeTool(os.path.abspath("sandbox"), approvalDeadline = 610)

val brain = Model.default()

// The context is the one piece that must outlive a turn: it carries the
// conversation from one turn to the next.
val context = new FullContext:
  baseSystem = File.read("prompts/SYSTEM.md")
  initial = []

// Skills give the model Jo syntax on demand without carrying the full
// reference in every prompt.
val tools = SkillTools.toolset(os.path.abspath("skills")) ++ runCode.toolset()
```

There is no `Agent` object to build — these are just values, and a turn is the
call that brings them together. The `Toolset` holds both halves of a tool: the
spec the model is offered, and the code that runs when it calls. The rest of the
file reads terminal input, hands it to `Agent.ask` with these pieces, and
prints the answer:

```jo
Agent.ask(input, brain = brain, tools = tools, context = context, maxToolRounds = 10, maxRetries = 2)
```

`input` is the raw string from the terminal — `ask` takes the message itself, so
nothing has to wrap it first.

`SimpleInteract` implements the interface through which the engine reports turn
events and asks whether a turn was cancelled:

```jo
private class SimpleInteract
  view Interact

  def cancelled: Bool = false

  def pause(seconds: Float): Bool =
    py.module("time").sleep(py.dynamic(seconds))
    false

  def approve(title: String, detail: String): Approvals.Decision =
    Approvals.Cancelled

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

- [Create a PDF processing agent](/examples/pdf-agent/) — browser sessions,
  streaming, uploads, and downloadable files.
- [Create a Telegram agent](/examples/telegram-bot/) — persistent bot
  sessions, authorization, attachments, and Telegram rendering.
- [Create a custom capability](/tutorial/create-custom-capabilities/) — give
  model-written programs narrowly typed access to your own systems.
