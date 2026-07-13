+++
title = "Media"
weight = 9
+++
Agents deal in text, but the world ships files: PDFs, scans, screenshots,
spreadsheets, slide decks. Handling one means answering two separate questions —
*where do the bytes come from?* and *what turns them into something the model can
read?* Harpe keeps those as two seams so they never entangle:

- a **`MediaProvider`** maps an identifier to media — describing it, then loading
  its bytes on demand — a source;
- a **converter** turns those bytes into text — understanding.

An ordinary [tool](@/concepts/tools.md) joins the two: resolve a path through the
provider, load its bytes, convert, return the text.

## Understanding is separate from the chat model — on purpose

You could send a file straight to a multimodal model and let it reason over the
pixels. Harpe does not make that the default, and the reason is architectural: a
file understood *at the edge*, converted to text once, then flows through the
ordinary transcript. That keeps the pipeline uniform (the chat model is always fed
text, so swapping it never touches file handling), keeps the transcript cheap (a
file is understood once, not re-billed every turn it sits in history), and lets the
understanding step be anything — markitdown, an OCR engine, a **local** vision model
that never leaves the machine, or a cloud multimodal model used *as* a describer.
Fusion becomes one converter choice, not the shape of the whole system.

The trade is real: the model reasons over the *description*, not the original
pixels, so fine cross-modal questions ("compare the chart on page 3 to the table")
depend on the converter's prompt. For agent workloads that is almost always fine.

## The `Media` descriptor

A resolved file is a provider-neutral **descriptor** — its MIME type and an open bag
of **typed** metadata. It deliberately does *not* hold the content: `resolve` is
cheap (type and metadata only), and the bytes are read separately, on demand, via
`load` — so describing a large file never loads it.

```jo
class Media(mimeType: String, fileName: String, meta: Map[String, Meta])
```

`mimeType` and `fileName` are intrinsic; everything else — `source`, `sizeBytes`,
… — lives in `meta`.

`meta` is structured, not a flat string map — a numeric value keeps its type
(`type Meta = String | Int`):

```jo
var meta = Map.empty[String, Meta]
meta = meta.add("source", "report.pdf")   // String
meta = meta.add("pages", 12)              // Int
```

The key set (`source`, `sizeBytes`, `pages`, …) is a **convention**, not a schema:
a provider stamps what it knows, a converter reads what it needs, and neither grows
the type. Read a string-valued key with `media.metaString(key)`.

## Providers: where bytes come from

```jo
interface MediaProvider
  def resolve(id: String): Option[Media]   // descriptor; None when the id names nothing
  def load(id: String): py.Dynamic         // the bytes, on demand
```

The two-step split — describe cheaply with `resolve`, read the bytes with `load` —
means a tool that only needs the type or size never pays to load the file. This one
seam is also what keeps the design additive: because every tool is written against
this interface and never learns about sources, **N** tools and **M** sources compose
as **N + M**, not N × M — add a source and every tool can read from it; add a tool
and it works with every source. An agent builds its `M` sources into one dispatching
provider (by id scheme, say) and hands that single value to each tool.

Providers are **read-only**. An agent that *produces* media — a thumbnail, a
rendered page — does so through a dedicated tool that stores the result itself;
storage is the application's concern, not this seam's.

### The shipped provider

The framework ships `FileSystemProvider`, over files under a root directory. It
addresses files by a **key** that a `keyToPath: String => String` mapping turns into
a path relative to the root; resolution is then **confined** to the root — a `..`
escape or an absolute path landing outside resolves to `None`, never a file
elsewhere on the host.

`keyToPath` is the access-control seam:

- **Trusted / CLI** — the identity mapping, `FileSystemProvider.byPath(root)`: the
  key *is* the path, because the user hands paths to the model directly.

  ```jo
  val provider = FileSystemProvider.byPath(workspace.root)
  ```

- **Multi-tenant / SaaS** — a lookup that maps opaque, unguessable handles to paths.
  The model can only reach files it was explicitly granted; it cannot construct or
  enumerate paths (the underlying path is not a valid key). Confinement to the root
  still applies underneath, as defense in depth.

  ```jo
  // the app grants files under random handles, then:
  val provider = new FileSystemProvider(root, key => grants.getOrElse(key, ""))
  ```

Sources that live elsewhere — an upload store, a bucket, a chat platform's file
API — are yours to implement. That is the storage boundary: the framework handles
representation, confinement, and transport to the model; your app supplies the
bytes.

## The tool: joining a source to a converter

There is no special media-tool type — a file reader is an ordinary `Tool`. It takes
a `path`, resolves it through the provider, converts, and returns the text
(bounded, so one large document cannot flood the context). A failing conversion is
safe to raise: the engine's `runSafely` backstop (see [tools](@/concepts/tools.md))
turns it into an error result fed back to the model.

## Example: the CLI's `readFile` tool

The CLI agent wires `workspaceMedia` to Microsoft's
[markitdown](https://github.com/microsoft/markitdown), which renders PDFs, images
(with OCR), Office documents, HTML, CSV, and more to Markdown:

```jo
// src/Markitdown.jo
def markitdownConvert(media: Media, content: py.Dynamic): String =
  // stage the bytes in a temp file, run markitdown, return its Markdown
  ...

def fileTool(provider: MediaProvider): Tool =
  Tool:
    "readFile"
    "Read a file from the agent's working directory and return its text as Markdown."
    [Tool.strParam("path", "The file to read, relative to the agent directory.")]
    input => readFile(provider, input.string("path"))

private def readFile(provider: MediaProvider, id: String): Tool.RunOutcome =
  match provider.resolve(id)
  case None =>
    new Tool.RunOutcome("No file found at '\{id}'.", "not found · \{id}")

  case Some(media) =>
    val markdown = markitdownConvert(media, provider.load(id))
    new Tool.RunOutcome(Tool.elide(markdown, 4000), "read · \{id}")
```

```jo
// src/Config.jo — add it to the session toolset
val tools = Defaults.tools() ++ memoryTools(memory) ++ [fileTool(FileSystemProvider.byPath(workspace.root))]
```

Swapping the backend — an OCR engine, a local vision model — is a local edit to the
converter; the provider and the tool are unchanged. That is the whole point of
keeping the two seams apart.

Using it needs the `markitdown[all]` Python package (see the CLI's
`requirements.txt`).
