+++
title = "Create a CLI Agent"
+++
The CLI template is a complete terminal application with input history,
progress feedback, cancellation, resumable sessions, memory, and an audit log.
Its source is copied into your project so you can inspect and change every part
of it.

## Create the project

```sh
jo new my-agent --template typescope/harpe:cli
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`, then start it:

```sh
jo start
```

`jo start` first builds the typed sandbox and then runs the terminal
application. Type a message to begin. Press Escape to interrupt an active turn.

By default, every launch starts a new session. To continue an earlier one, run:

```sh
jo resume
```

The CLI lists the five newest sessions. Enter a number to restore its
conversation and memory. Press Enter to start a new session.

## Make the first change

Replace the first paragraph of `AGENT.md` with:

```markdown
# Release Assistant

You help developers prepare software releases. Keep answers concise and always
end with the next concrete action.
```

Restart `jo start` and ask:

```text
You ▸ I need to release version 1.2.0.
```

The reply should now follow the role and response style you wrote. This is the
fastest customization loop: edit the instructions, restart, and try a real
request.

## What to customize

The generated project is ordinary Jo source:

```text
my-agent/
  AGENT.md             # identity and standing instructions
  src/
    Cli.jo             # assembles the model, tools, context, and turn policy
    Console.jo         # terminal input, output, and cancellation
    Spinner.jo         # progress display
  sandbox/
    SandboxAPI.jo      # capabilities available to model-written programs
    SandboxRuntime.jo  # trusted implementations of those capabilities
    Task.jo            # placeholder replaced by runCode
  skills/              # reference material the agent can read
  data/                # files available to the agent
  logs/                # sessions and structured audit events
```

Start with `AGENT.md`. Change the role, behavior, and boundaries in plain
language. Add reference material under `skills/`.

To change what generated programs may do, edit the sandbox contract and its
trusted runtime together. A capability omitted from `SandboxAPI.jo` cannot be
used by model-written code.

To change model selection, tools, context management, retry policy, or tool
budget, edit the `Agent` construction in `src/Cli.jo`.

## When to use this template

Choose CLI for local tools, developer assistants, experiments, and the shortest
path from an idea to a working agent. If you only want to understand Harpe's
mechanism first, use the smaller [`hello` walkthrough](/tutorial/build-your-first-agent/).
