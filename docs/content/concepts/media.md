+++
title = "Media"
+++
Harpe keeps file transport in the application and file processing in generated
programs. A driver receives and stores files, the sandbox works with them
through typed capabilities, and the driver delivers generated files back to the
user.

## One data directory per session

The driver sets `HARPE_DATA_DIR` in the turn's `CallContext`. The shipped agents
scope it differently:

- CLI uses the application's `data/` directory.
- Web creates `data/<session-id>/`.
- Telegram creates `data/<chat-id>/`.

The sandbox's file and document capabilities are rooted there. Generated code
sees relative paths, never the surrounding workspace or a host path.

For the guest-facing APIs, see:

- [`FileSystem`](/capabilities/file-system/)
- [PDF](/capabilities/pdf/)
- [Workbook](/capabilities/workbook/)
- [Word](/capabilities/word/)
- [Image](/capabilities/image/)
- [OCR](/capabilities/ocr/)

## Receiving files

Web uploads and Telegram attachments are saved into the session data directory
before the agent processes the message. The transcript stores an `Attachment`
record, not the bytes:

```jo
class Attachment(name: String, size: Int, mime: String, inline: Bool)
```

The model receives a short manifest appended to the user message:

```text
[The user attached these files, available in your data directory — read them
with `fs`: report.pdf, orders.xlsx]
```

To add file input to another driver:

1. create a data directory scoped to the user or session
2. sanitize and de-duplicate inbound filenames
3. save the bytes before calling `Agent.runTurn`
4. add an `Attachment` for each saved file to `UserText`
5. put the directory in `CallContext` as `HARPE_DATA_DIR`

Do not put file bytes, credentials, storage keys, or host paths in the
transcript. For remote storage, materialize only the files granted to this
session into its data directory.

## Showing a file to the model

An attachment is reference-only by default. The model knows its name and can
read it through generated code. This is usually cheaper and more precise than
sending the complete file to a multimodal model.

When layout or pixels matter—a chart, screenshot, photo, or scan—the built-in
`uploadMedia` tool shows a file from the data directory directly to the chat
model. It supports JPEG, PNG, GIF, WebP, and PDF.

The tool returns an `Attachment` with `inline = true`. Anthropic and OpenAI then
render the bytes as an image or document block on the next model request.

Inline media is request-scoped:

- an inline user attachment is sent only with the newest user message
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
all rooted at `HARPE_DATA_DIR`. Replace a backend there without changing the
guest API. Keep credentials and remote clients in the trusted runtime.

Parsers and OCR engines still process untrusted input. Use the optional runtime
isolation described in [Add Defense in Depth](/tutorial/defense-in-depth/) for
resource limits and process confinement.
