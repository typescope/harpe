+++
title = "Media"
weight = 11
+++
Agents deal in text, but the world ships files: PDFs, scans, screenshots,
spreadsheets, slide decks, multi-GB logs. A Harpe agent acts by writing programs, so
it reaches media the same way — not through a tool that dumps one file's text into
the transcript, but through **capabilities** its program holds: the model's Jo code
receives a filesystem and a set of format processors, reads exactly what it needs,
and prints only the answer.

## Media is a capability, not a tool

The older shape was a `readFile` tool: name a path, get its whole text back, elided
to fit. That is fine for a small file and clumsy for everything else. A tool call
cannot tail a 2 GB log, cannot read page 40 of a report without the other 39, cannot
sum a spreadsheet column without dragging the sheet into the context. Each of those
is a *program*, and a Harpe agent already writes programs:

```jo
def runTask(): Unit receives stdout, fs =
  // scan a huge log — streamed line by line, the file is never loaded
  match fs.openTextFile("logs/app.log")
  case Err(e)  => println: e
  case Ok(log) =>
    for line in log.lines do
      if line.contains("ERROR") then println: line

    log.close()
```

## The pieces

Media support is a small set of types that compose. The interfaces live in the pure
**`caps` module** — no FFI, no implementations — which is what a sandbox guest
depends on. The trusted implementations live in the `harpe` module and never enter
the guest's dependency graph.

| Piece | What it is |
|-------|------------|
| `FileSystem` | the confined tree: `exists`, `isFile`, `stat`, sorted typed `list`, one-shot reads, and open files |
| `TextFile` / `BinaryFile` | a closeable open file with whole, windowed, and lazy text line reads |
| `Media` / `MediaProvider` | granted media by opaque id: `resolve` a descriptor, `load` into the tree |
| `PDF`, `Word`, `Image`, `OCR` | format processors — each a separately granted capability |

### `FileSystem` — a confined tree of openable files

Filesystem methods take portable relative paths such as `"docs/report.pdf"`.
Implementations validate each path with `FileSystem.validate` before resolving it
against their root. The helper rejects absolute paths, parent traversal, empty
segments, backslashes, drive paths, and NUL. It returns `None` for a valid path or
`Some(message)` for an invalid path. An empty string names the root:

```jo
val entries = fs.list("").success
```

For a small file, the one-shots `readText` / `readBytes` open, read whole, and
close in one call. For a large one, `openTextFile` gives a `TextFile` with the
shapes text actually needs: `text` (whole), `head(n)` / `tail(n)` (the first or
last lines — `tail` reads backward from the end, so a 2 GB log's tail costs only
the tail), and `lines` (a lazy iterator with bounded memory. A line window is
`lines.drop(a).take(b)`). `openBinaryFile` gives a `BinaryFile` — `bytes` (whole)
and `read(offset, length)` (random access, the byte window that text deliberately
does not offer). Open files carry their `size` and are closed by the program.

`stat` returns the single metadata record — `FileInfo(isFile, sizeBytes,
modifiedAt)` — cheap enough to rank a directory by recency before reading anything.
`list` returns sorted, typed entries (`DirEntry(path, isDirectory)`), so a tree
walk needs no extra stat per entry. All I/O is local, against a root the host
chose.

Text decodes as UTF-8 by default, with undecodable bytes becoming U+FFFD — a scan
of a log with stray binary never crashes, and mojibake in the output is itself the
signal. Legacy Windows files are one retry away: `openTextFile(path,
"windows-1252")`. The encoding names are a fixed two-element set specified by the
interface, not whatever the runtime's codec registry happens to accept, so a
program means the same thing under every runtime.

### `MediaProvider` — granted media by id

Media that is not already a local file — an upload, a chat attachment, an object in
a store — is granted by **id**. The provider answers two questions:

```jo
interface MediaProvider
  def resolve(id: String): Option[Media]        // descriptor: mime, name, metadata
  def load(id: String, target: String): Bool    // relative destination path
```

### Errors come back in the type

The guest is pure Jo with no exception handling, so any failure not encoded in a
return type is an unhandleable crashed run. And the model's programs are
speculative — they guess paths, pages, formats — so failure is *expected*, not
exceptional. Every capability therefore answers environment errors in its type:
`Result[T, String]` when there is a reason to give (a missing file, a corrupt
document, an out-of-range page), `Option` when absence says it all (`resolve`,
`stat`). The model branches with a `match`, or unwraps the happy path with
`.success`. Reads on an already-open file are total. Misuse, such as reading a closed
file, a negative offset — aborts the run.

`resolve` is cheap — a stat, no read — returning a `Media` descriptor (`mimeType`,
`fileName`, and an open bag of typed metadata: `sizeBytes`, `pages`, …), so the
model can decide whether a file is worth loading. `load` puts the bytes at a
relative path the model names. From there the guest reads through `FileSystem` or
hands the path to a processor.

### Processors — format capabilities

A processor turns a file named by a relative path into text or structured values. Each is
FFI-backed, so each is a **separately granted capability** — an agent may read PDFs
but not run OCR — and every method is FFI-bound: anything composable in pure Jo
(searching a document, say, is a loop over `pageText`) deliberately stays out of the
interfaces.

```jo
interface PDF
  def pageCount: Int
  def outline: List[Heading]
  def metadata: Map[String, String]
  def pageText(page: Int): Result[String, String]
  def pageContent(page: Int): PageContent
  def pageImage(page: Int, target: String, scale: Int = 2): Result[ImageSize, String]
  def close(): Unit

interface Image                                                         // pixel work only
  def dimensions(src: String): Result[ImageSize, String]
  def metadata(src: String): Result[Map[String, String], String]
  def resize(src: String, width: Int, height: Int, target: String): Result[ImageSize, String]
  def crop(src: String, x: Int, y: Int, width: Int, height: Int, target: String): Result[ImageSize, String]
  def convert(src: String, target: String): Result[ImageSize, String]

interface OCR                                                           // content extraction
  def text(src: String): Result[String, String]
```

The `PDF` methods are picked for how an agent navigates a large document: `outline`
is the map (find the section, then `pageText` just its pages), `metadata` identifies
the document without parsing content, and `pageContent` is the cheap "what kind of
page is this" probe — no text but an image means a scanned page. PDF has no table
structure (a table is text runs plus ruling paths), so `pageContent` reports the
honest counts rather than pretending to detect tables.

`OCR` is split from `Image` because the seams differ on both axes. Grant-wise,
resize/crop/convert are innocuous pixel work while OCR is content extraction — the
thing an agent may specifically be denied. Backend-wise, the image library and the
OCR engine swap independently: the framework ships a Tesseract-backed reader and a
RapidOCR-backed one (pure pip, stronger on photos), and a cloud OCR or vision-model
describer arrives later as another implementation of the same interface.

Processors that *produce* a file — a rendered page or resized image — write to a
relative target the caller names. The implementation validates it before writing.

## The pieces compose

The capabilities are designed to chain. The canonical example — read a PDF page,
and fall back to OCR when it turns out to be scanned:

```jo
def runTask(): Unit receives stdout, fs, media, ocr =
  media.load(reportId, "report.pdf")
  val doc = fs.openPDF("report.pdf").success
  val txt = doc.pageText(40).success

  if txt != "" then println: txt
  else
    // a scanned page: render it, then read the pixels
    val _ = doc.pageImage(40, "p40.png").success
    println: ocr.text("p40.png").success

  doc.close()
```

Every step is a typed call the model composes itself — no host round-trip per file,
no transcript bloat, and the toolset a turn holds is the exact set of formats it may
read.

## What the model sees: ids, never host paths

The model never sees a host path, a bucket key, or a foreign object.

- In a **multi-user** deployment it holds per-session ids. Media enters a session at
  ingress — a web upload, a chat file — and the app mints an unguessable id and
  registers it in the session's provider. The model learns ids from the turn
  context and calls `media.resolve` / `media.load` with them. A forged id resolves
  to `None`. Another session's media is unreachable.
- In a **single-user / CLI** deployment the model browses the workspace directly
  through `FileSystem` — the user is handing their own files to their own agent.

The shipped host-side source is `FileSystemProvider(root, keyToPath)`: files under a
root, addressed by a key that `keyToPath` maps to a relative path, confined to the
root underneath as defense in depth. `keyToPath` is the access-control seam — the
identity mapping for the trusted CLI case, a session-grant lookup for multi-tenant.
Sources that live elsewhere (an upload store, a bucket, a chat platform's file API)
implement the same pair. Storage is the application's concern, not the framework's.

## The broker: how granted media crosses the boundary

The provider is a live object in the host process — it may hold a database handle,
a bucket client, the session's grant map. The guest runs in a separate, confined
process. The **broker** bridges them: before launching a guest, the host stands up
a listener on a Unix socket in the run's directory, bound to *this run's* scoped
services, and the capability implementation in the guest is a thin client over it.

The media service exposes exactly `stat` and `load` — a scoped oracle whose whole
obligation is to describe and materialize resources this session was granted. No
bytes stream over the socket: `load` writes into the run directory host-side, and
the guest reads the file locally. Every richer step — parsing, rendering, OCR —
happens *inside* the confined guest, which is a security decision: a crafted PDF
exploits the parser inside the sandbox's walls, never in the trusted host.

The broker is not media-specific. It is the framework's one synchronous host↔guest
channel. It is a service registry the guest reaches by name, with media as its first service.
The socket is per run, so concurrent runs are isolated by construction.

## Understanding is separate from the chat model — by default

You could send a file straight to a multimodal model and let it reason over the
pixels. That is not Harpe's default, and the reason is architectural: a file
understood by the program, converted to text once, then flows through the
ordinary transcript. That keeps the pipeline uniform (the chat model is normally
fed text, so swapping it usually leaves file handling untouched), keeps the
transcript cheap by default (a file is understood once, not re-billed every turn
it sits in history), and lets the understanding step be anything — a PDF text
layer, an OCR engine, a **local** model that never leaves the machine, or a cloud
multimodal model used *as* a describer behind the `OCR` interface. Fusion becomes
one implementation choice, not the shape of the whole system.

The trade is real: the model reasons over the *extraction*, not the original pixels,
so fine cross-modal questions ("compare the chart on page 3 to the table") depend on
what the processors surface. For agent workloads that is almost always fine — and
`pageImage` keeps the pixels one call away.

### The opt-in escape hatch: showing the chat model real pixels

This is a different, host-side mechanism from the guest-side `MediaProvider`
above — it is not about what a program's *code* can read, but about what the
*chat model itself* sees in its request, for the small set of cases (a photo,
a chart, a scanned form with no legible text) where OCR/text extraction loses
too much.

An `Attachment` — the reference-only record a `UserText` or a tool result
carries — has an `inline` flag. When it is `true`, the provider render layer
(`agent/models/Anthropic.jo`, `OpenAI.jo`) builds a real `image`/`document`
content block from the file's bytes (base64, gated to the mime types each
provider's vision API accepts, including JPEG/PNG/GIF/WebP images and PDF documents.
anything else stays reference-only regardless of the flag) instead of, or
alongside, the usual text reference. Nothing about this touches the persisted
transcript: `inline` is stored exactly as given, and the render layer alone
decides whether to act on it, checked fresh on every request.

That decision is deliberately narrow, to keep the "not re-billed every turn"
property that makes the default path cheap:

- A `UserText`'s attachment inlines only when that message is the **newest**
  one in the model's rendered window. Once a later turn starts, the same
  history is rebuilt from scratch and that attachment is no longer newest — it
  silently falls back to reference-only, so a past image is never resent (and
  re-billed) on every turn it sits in history.
- A tool result's `media` (`Tool.RunOutcome`/`ToolResult`) inlines
  unconditionally, but only within the turn the tool was called — a tool
  result is never re-derived from committed history the way it is from a
  fresh call, so the same guarantee holds without needing a positional check.

Any tool can use this — `RunOutcome` carries a `media: List[Attachment]`
alongside its text result, so a tool that resolves a data-directory file (an
`uploadMedia`-style tool, for instance) can hand the model real pixels on
demand, in the turn the file arrives or any later turn the model asks for it
again — full fidelity each time, not a cached description. This is additive
to everything above: OCR and the other processors remain the default and only
automatic path: an attachment is inlined only when some tool explicitly says
so, never automatically just because it exists.

## Why it is secure

Layers, from the type outward:

- **The interface is the grant.** The capabilities are read-only over the granted
  tree, and one a turn was not granted does not compile, so it never runs — the
  [compile-time gate](/concepts/sandbox/). The interfaces come from the pure
  `caps` module, so implementations are not even in the guest's dependency graph.
- **Media identifiers are opaque.** A forged id resolves to `None`, and another
  session's media remains unreachable. Filesystem implementations validate relative
  paths before resolving them inside their configured root.
- **The broker is the trust boundary, and it lives in the host.** Even a guest that
  broke the type gate could only ask the broker for this session's grants — the
  blast radius is media the model was meant to read.
- **OS layers confine the parsing.** Processors run guest-side, so
  [`run.sh`](/tutorial/defense-in-depth/)'s quotas, severed network, and filesystem
  allowlist contain a parser exploit — the reason parsing was pushed into the guest
  to begin with.

## Backends

The shipped implementations and their Python packages (see `requirements.txt`):

| Capability | Implementation | Backend |
|------------|----------------|---------|
| `PDF` | `PdfiumReader` | pypdfium2 — PDFium, Chrome's PDF engine. It renders pages from a self-contained wheel. |
| `Word` | `MarkitdownReader` | markitdown |
| `Image` | `PillowImage` | Pillow |
| `OCR` | `TesseractOcr` | `tesseract` system binary (degrades to a message without it) |
| `OCR` | `RapidOcr` | rapidocr-onnxruntime — pure pip, stronger on photos and rotated text |

Swapping a backend is a new class behind the same interface. The grant, the broker,
and the model's programs are unchanged. That is the point of keeping the seams
apart.
