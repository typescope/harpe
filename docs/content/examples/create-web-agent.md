+++
title = "Create a Web Agent"
+++
The web template is a complete browser application with persistent sessions,
streamed progress, uploads, downloadable files, and a customizable frontend.
The server and frontend sources are copied into your project.

## Create the project

```sh
jo new my-agent --template typescope/harpe:web
cd my-agent
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` in `.env`.
OpenRouter also requires `MODEL`. You can also change the
listening address:

```sh
HOST=127.0.0.1
PORT=8765
```

Start the application:

```sh
jo start
```

Open `http://127.0.0.1:8765`. Each conversation has its own URL and can resume
after the process restarts.

[![The Harpe web agent showing persistent conversations, generated-program traces, PDF attachments, an SVG result, and files scoped to the current session.](/img/web-agent.gif)](/img/web-agent.gif)

## Make the first change

Change the agent name shown in the left sidebar. In `src/Web.jo`, find:

```jo
val server = new ChatServer(brain, "Clair", …)
```

Replace `"Clair"` with your agent's name. Edit `AGENT.md` to give it a matching
role, then restart `jo start` and reload the page. The new name should appear in
the sidebar, and replies should follow the new instructions.

Send a message and copy the URL. Restart the application and open that URL
again. The conversation should still be present.

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
  skills/
    jo-syntax.md
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

When you are ready to deploy, follow [Serving HTTP](/guides/serving-http/) for
server configuration, request limits, session concurrency, and reverse proxies,
then review the [Deployment Checklist](/guides/production/).
