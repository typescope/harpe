+++
title = "Media"
+++
Harpe keeps file transport in the application and file processing in generated
programs. A driver receives and stores files, the sandbox works with them
through typed capabilities, and the driver delivers generated files back to the
user.

## One data directory per session

The driver owns the data directory: it passes the path to the tools that need it
when it wires their routes, and gives each `Attachment` the path its bytes live
at. Nothing in the framework has to be told where the directory is. The shipped
agents scope it differently:

- CLI uses the application's `data/` directory.
- Web creates `data/<session-id>/`.
- Telegram creates `data/<chat-id>/`.

The sandbox's file and document capabilities are rooted there. Generated code
sees relative paths, never the surrounding workspace or a host path.

For the guest-facing APIs, see:

- [File System](/capabilities/file-system/)
- [PDF](/capabilities/pdf/)
- [Excel](/capabilities/excel/)
- [Word](/capabilities/word/)
- [Image](/capabilities/image/)
- [OCR](/capabilities/ocr/)

## Receiving files

Web uploads and Telegram attachments are saved into the session data directory
before the agent processes the message. Neither driver sends them to the model:
an upload should cost nothing until the agent decides it needs the file. Both
name the files in the message text instead, with `Model.userContent`, and the
turn's transcript record carries what the user actually uploaded.

An `Attachment` is what a file looks like when the model *is* shown it —
metadata and a path, never the bytes:

```jo
class Attachment(name: String, size: Int, mime: String, path: String)
```

The model receives a short manifest appended to the user message:

```text
[The user attached these files, available in your data directory — read them
with `fs`: report.pdf, orders.xlsx]
```

To add file input to another driver:

1. create a data directory scoped to the user or session
2. sanitize and de-duplicate inbound filenames
3. save the bytes before calling `Agent.ask`
4. decide whether the model should SEE each file or merely know it exists. To
   show it, pass its path in `attachments`. To keep it out of the request — what
   the web and Telegram drivers do, so an upload costs nothing until the agent
   wants it — name it in the message text with `Model.userContent` and let the
   agent reach for `fs` or `uploadMedia`
5. pass the directory to the routes that need it (`uploadMedia`, your `sendFile`)
   and to your sandbox runtime as its own environment variable

Do not put file bytes, credentials, storage keys, or host paths in the
transcript. For remote storage, materialize only the files granted to this
session into its data directory.

## Showing a file to the model

Naming a file is the default. The model knows it exists and can read it through
generated code, which is usually cheaper and more precise than sending the whole
thing to a multimodal model.

Attaching one is the exception, and it is what `Attachment` means: a file in
`attachments` is *shown*, rendered as a real image or document block where the
provider takes the type. `Agent.ask` builds them from paths:

```jo
Agent.ask("what is on this chart?", ["reports/q3.png"])
```

When layout or pixels matter mid-conversation—a chart, screenshot, photo, or
scan the agent only now realizes it needs—the built-in `uploadMedia` tool pulls
a file from the data directory into the model's view. It supports JPEG, PNG,
GIF, WebP, and PDF, and returns it as an `Attachment` so Anthropic and OpenAI
render the bytes on the next request.

Showing a file is request-scoped:

- a user message's attachments are sent only while it is the newest message
- media returned by a tool is sent with that tool result
- older transcript entries retain metadata but are not uploaded again

This avoids resending and rebilling the same media on later turns. The model can
call `uploadMedia` again when it needs the original pixels again.

## Returning a file to the user

Generated programs create files in the data directory through `fs`, document
renderers, or image operations. Delivery is driver-specific.

The shipped Web and Telegram agents add a `sendFile` tool:

```text
sendFile(fileName: "summary.pdf")
```

The argument is a basename in the session data directory. Web renders a file
attachment and serves it from that session. Telegram uploads the file to the
chat.

`uploadMedia` and `sendFile` have different audiences:

- `uploadMedia` shows a file to the model
- `sendFile` delivers a file to the user

A custom driver can implement a different delivery tool or include generated
files in its response protocol.

## Customizing media support

The CLI, Web, and Telegram templates declare file and document capabilities in
`sandbox/SandboxAPI.jo`:

```jo
defer def runTask(): Unit receives
  stdout, fs, pdfReader, excelReader, wordReader, image, ocr
```

Remove capabilities the agent does not need. Generated code that names an
omitted capability will not compile.

`sandbox/SandboxRuntime.jo` binds each interface to a trusted implementation,
all rooted at the guest's data directory (named by whatever environment variable
the driver and its runtime agree on, passed through `runCode`'s `guestEnv`).
Replace a backend there without changing the
guest API. Keep credentials and remote clients in the trusted runtime.

Parsers and OCR engines still process untrusted input. Use the optional runtime
isolation described in [Add Defense in Depth](/guides/defense-in-depth/) for
resource limits and process confinement.
