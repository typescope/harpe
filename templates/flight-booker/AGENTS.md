# flight-booker development

This is a Jo application using Harpe on Python.
This file guides development. Runtime instructions belong in
[prompts/SYSTEM.md](prompts/SYSTEM.md). Treat runtime prompts and skills as
application content.

## Commands

Run commands from the project root. See [README.md](README.md) for configuration.
Activate the environment in each shell before installing dependencies or running Jo.

- Create a virtual environment if missing: `python3 -m venv .venv`.
- Activate it: `. .venv/bin/activate`.
- Install dependencies: `python -m pip install -r requirements.txt`.
- Build the application: `jo build agent`.
- Build the sandbox: `jo build --spec sandbox/jo.toml guest`.
- Query resolved APIs: `jo compile --query jo.List,jo.Map` (replace the selectors
  with the APIs you need).
- Run the web application after configuration: `jo start`.

There is no automated test target yet. Build the modules affected by code changes.
Build both when changing their integration.
Inspect the diff before handing off. Report checks run and any that could not run.

## Development conventions

- Prefer colon call syntax for multiline and nested calls.
- Enforce offer validation and human approval in `DuffelClient.createOrder`.
  Rejection, cancellation, or timeout must prevent booking.
- Keep the example in Duffel test mode. Use test credentials for live checks.
- Serialize each session's turns. Preserve cancellation and approval handling.
- Keep browser requests and event handling in sync with the server.
- Keep credentials and HTTP access in trusted application or runtime code.
- Keep Python FFI out of the API and guest modules.
- Change capability APIs, runtime bindings, and the `runTask` placeholder together.
  Update affected prompt examples.
- Keep [skills/api.jo](skills/api.jo) in sync with [sandbox/API.jo](sandbox/API.jo).
- Do not edit generated `.build/` output.
- If Jo or Harpe crashes or appears to have a bug, reduce it to a small
  reproduction and submit an issue with the reproduction and version details.

## References

- [Jo documentation](https://jo-lang.org/): syntax, capabilities, and build commands.
- [Jo GitHub](https://github.com/typescope/jo): implementation and tests.
- [Harpe documentation](https://harpe.typescope.ai/): concepts and extension patterns.
- [Harpe GitHub](https://github.com/typescope/harpe): APIs, examples, and tests.

Use local examples first. Consult documentation and source when unsure.
Check [jo.toml](jo.toml) and [sandbox/jo.toml](sandbox/jo.toml) for declared versions.
Use `jo.lock` files, when present, for resolved package versions.
Read source at the matching release tag or commit.
Current documentation and `main` may describe newer APIs.
