+++
title = "Media"
+++
A user uploads a scanned invoice. A tool pulls down a spreadsheet. A turn
renders a chart the user should get back. Each time, something has to decide how
much of the file the model actually sees — a 40-page PDF pushed through a
multimodal request costs real tokens, and a spreadsheet shown as a picture is a
poor way to read a spreadsheet.

Harpe gives you both routes — process the file locally, in code the agent
writes, or send the file itself to the model — and leaves the choice with you,
file by file.

## Sending a file to the model

Sending one means passing its path to `Agent.ask`:

```jo
Agent.ask("what is on this chart?", ["reports/q3.png"])
```

What the model actually sees depends on the type: JPEG, PNG, GIF, and WebP on
every provider, PDF on Anthropic, OpenAI, and OpenRouter. Attach a spreadsheet
and nothing is sent — the model gets its name, and nothing more.

What is sent is scoped to a single request:

- a user message's attachments are sent only while it is the newest message
- media returned by a tool is sent with that tool result
- older transcript entries keep their metadata but are not uploaded again

So the same image is never resent, and never rebilled, on a later turn.

## Programmatic file processing

A user drops a 40-page contract into the chat and asks what the penalty clause
says. Send it and the whole document rides into the request, every page billed,
for one clause the agent could have found in code.

So don't send user uploads blindly. Save them into a directory — one per user or
session, handed to your sandbox runtime — and name the file in the message
instead:

```text
what does the penalty clause say?

[The user attached these files, available in your data directory — read them
with `fs`: contract.pdf]
```

The model learns the file is there, and nothing else goes out. It opens the
contract with `fs` and `pdfReader`, finds the clause, answers. `fs` reads
anything in that directory, and the document, image, and OCR capabilities do the
rest:

- [File System](/capabilities/file-system/) — `fs`
- [PDF](/capabilities/pdf/) — `pdfReader`
- [Excel](/capabilities/excel/) — `excelReader`
- [Word](/capabilities/word/) — `wordReader`
- [Image](/capabilities/image/) — `image`
- [OCR](/capabilities/ocr/) — `ocr`

Generated code sees relative paths, never the agent's own directories or a host
path. Web and Telegram both take uploads this way. Keep file bytes, credentials,
storage keys, and host paths out of the transcript.

## On-demand file reading

Withholding the bytes is only safe because the agent can ask for them. Code is
not always enough — OCR comes back empty on a scan, or the agent renders a chart
and wants to check its own work, and it has to look at the thing. That is what
`uploadMedia` is for: give it a file name in the data directory and it returns
the file as an attachment on its own tool result, so the bytes go out with the
next request. Wire it with the directory it may read from:

```jo
val tools = runCode.toolset() ++ UploadMediaTool.toolset(dataDir)
```

It takes the same five types. Anything else comes back as a refusal that points
the model at `ocr`, `pdf`, or `fs` — usually what it wanted anyway, and cheaper.

## Handing files back

The agent writes its output into the data directory, so by the time the turn
ends the file is already there. What the driver still needs is which one the user
should get — and that is structured output, not a capability. The model says it
by calling a tool.

The Web agent's `sendFile` moves no bytes at all. It checks the name, returns a
line of prose for the model, and the driver reads the calls back off the finished
turn to render attachments on the reply — see
[Structured output](/concepts/structured-output/) for the pattern.

```text
sendFile(fileName: "summary.pdf")
```

Yours might not be a tool at all, and carry generated files in the response
protocol instead. Whatever it is, keep it distinct from `uploadMedia`:

- `uploadMedia` sends a file to the model
- `sendFile` delivers a file to the user

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
Replace a backend there without changing the guest API. Keep credentials and
remote clients in the trusted runtime.

Parsers and OCR engines still process untrusted input. Use the optional runtime
isolation described in [Add Defense in Depth](/guides/defense-in-depth/) for
resource limits and process confinement.
