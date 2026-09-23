# pdf-agent

A browser agent. It serves a local chat page and runs one turn per message,
streaming progress as it goes. Uploads and downloadable files are supported.

## Setup

```sh
pip install -r requirements.txt
cp .env.example .env
```

In `.env`, set `MODEL` and one provider key: `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, or `OPENROUTER_API_KEY`. `HOST` and `PORT` are optional and
default to `127.0.0.1` and `8765`.

## Running

```sh
jo start
```

Then open <http://127.0.0.1:8765>.

Click **Logs** in the sidebar, or open <http://127.0.0.1:8765/journal>, to
inspect logs live. The viewer keeps the latest 5,000 entries across sessions
since the server started. Click a session scope to focus on its turns and tool
calls. Complete session logs remain in `logs/sessions/<session>.jsonl` across
restarts; the viewer's in-memory window starts fresh each time.

`jo run tests` runs the end-to-end suite: it starts the agent as its own process and
drives it over HTTP against a scripted model, so it needs no API key and
reaches no network.

## Layout

```text
pdf-agent/
  prompts/
    SYSTEM.md
  src/
  assets/
  sandbox/
  skills/
  tests/
```
