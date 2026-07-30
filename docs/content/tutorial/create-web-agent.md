+++
title = "Create a Web Agent"
weight = 3
+++
The web template is a complete browser application with persistent sessions,
streamed progress, uploads, downloadable files, and a customizable frontend.
The server and frontend source are copied into your project.

## Create the project

```sh
jo new my-agent --template typescope/harpe:web
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`. You can also change the
listening address:

```sh
HOST=127.0.0.1
PORT=8765
```

Start the application:

```sh
jo start
```

Open `http://127.0.0.1:8765`. Each conversation has its own URL under `/c/` and
can resume after the process restarts.

## Make the first change

Give the application a visible identity:

1. Edit `AGENT.md` to describe the agent you are building.
2. In `assets/app.css`, change the `--accent` and `--user` colors under
   `:root`.
3. Restart `jo start` and reload the page.

Send a message, copy the resulting `/c/...` URL, restart the application, and
open that URL again. The conversation should still be present. This verifies
both kinds of customization the template exposes: agent behavior in
`AGENT.md`, and application behavior and presentation in source and assets.

## What to customize

```text
my-agent/
  AGENT.md
  src/
    Web.jo             # application startup and model selection
    Server.jo          # HTTP routes, uploads, and event streaming
    Session.jo         # conversation state and persistence
    WebInteract.jo     # maps turn events to browser events
  assets/
    index.html
    app.css
    app.js
  sandbox/
    SandboxAPI.jo
    SandboxRuntime.jo
    Task.jo
```

- Edit `AGENT.md` to define the agent.
- Edit `assets/` to change the interface. The server reads these files from the
  project, so they remain fully under your control.
- Edit `src/Web.jo` to change startup and model selection.
- Edit the `Agent` construction in `src/Server.jo` to change tools, context,
  retries, or tool budgets. Edit `src/Session.jo` to change persistence.
- Edit the sandbox to grant domain-specific capabilities.
- Edit `src/Server.jo` when you need different routes, authentication, upload
  policy, or integration with an existing web application.

The generated server is application code, not hidden framework machinery. That
makes its session and file-handling behavior inspectable before you deploy it.

Next: [create a custom capability](/tutorial/create-custom-capabilities/).
