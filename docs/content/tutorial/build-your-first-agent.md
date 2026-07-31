+++
title = "Build Your First Agent"
+++
Harpe agents act by writing typed Jo programs. The `hello` template strips that
idea down to the smallest useful application so you can inspect the whole path
from a message to compiled code.

## Create the project

```sh
jo new my-agent --template typescope/harpe:hello
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Set either `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`.

The project is intentionally small:

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

The interaction is intentionally primitive—no spinner, cancellation, sessions,
or media—so you can see the essential agent loop in `Main.jo`. Use the CLI,
web, or Telegram template as the starting point for a more user-friendly agent.

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

That exchange is one **turn**. Harpe gives the model a single tool,
`runCode`. The model can answer directly, or use that tool to write a Jo
program, compile it against your sandbox, run it, and use its output.

## Inspect the application

Open `src/Main.jo`. It assembles the entire agent:

```jo
val agent = new Agent:
  brain = Defaults.model()
  tools = [runCodeTool(workspace.sandboxDir)]
  context = new FullContext:
    baseSystem = workspace.read("AGENT.md").getOrElse("")
    memory = memory
    initial = []
```

The rest of the file reads terminal input, passes it to `agent.runTurn`, and
prints the answer. `SimpleInteract` implements the small interface through
which the engine reports turn events and asks whether a turn was cancelled.
The learning template ignores events and always answers “not cancelled.” The
CLI template provides the full terminal behavior.

Nothing in this application is special configuration. It is Jo source copied
into your project, and you are expected to change it.

## Inspect the sandbox

`sandbox/SandboxAPI.jo` is the complete contract visible to model-written
programs:

```jo
namespace sandbox.api

import jo.IO.stdout

defer def runTask(): Unit receives stdout
```

The only granted capability is `stdout`. A generated program can calculate and
print, but it cannot access ambient files, the network, a shell, or your model
key. If it names an unavailable capability, compilation fails before anything
runs.

`SandboxRuntime.jo` is trusted application code. It supplies the capabilities
declared by the API and calls the generated implementation. `Task.jo` is the
build-time placeholder that proves the sandbox links. For each real tool call,
`runCode` compiles the model's program in a temporary directory without
modifying your project file.

This API/runtime/guest dependency boundary is Harpe's core security mechanism.
The [sandbox concept guide](/concepts/sandbox/) explains the compiler guarantee.
The [defense-in-depth tutorial](/tutorial/defense-in-depth/) adds OS-level
confinement.

## Change its behavior

Edit `AGENT.md`:

```markdown
# Hello

You are a cheerful mathematics tutor.
Explain the result in one or two sentences.
Use `runCode` whenever a calculation would make the answer more reliable.
```

Restart `jo start`. The application code and authority are unchanged, but the
agent now has different standing instructions.

When you add a real capability, you widen `SandboxAPI.jo` deliberately and
supply its implementation in `SandboxRuntime.jo`. The compiler then makes that
new boundary apply to every program the model writes.

## Build a complete application

The other templates use the same engine and sandbox, with production-oriented
application code around them:

- [Create a CLI agent](/tutorial/create-cli-agent/) — terminal history,
  cancellation, memory, skills, and audit logs.
- [Create a web agent](/tutorial/create-web-agent/) — browser sessions,
  streaming, uploads, and downloadable files.
- [Create a Telegram agent](/tutorial/create-telegram-agent/) — persistent bot
  sessions, authorization, attachments, and Telegram rendering.
- [Create a custom capability](/tutorial/create-custom-capabilities/) — give
  model-written programs narrowly typed access to your own systems.
