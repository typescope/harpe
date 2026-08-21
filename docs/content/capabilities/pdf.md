+++
title = "PDF"
+++
PDF support has two interfaces:

- `PdfReader` opens and validates a PDF file.
- `PDF` is the open, page-wise handle it returns.

`FileSystem.openPDF` is a shortcut through the ambient `pdfReader` capability.
`PDF` avoids turning an entire report into one large string and lets generated
code inspect only the relevant pages.

Open a PDF through `FileSystem`:

```jo
def runTask(): Unit receives stdout, fs, pdfReader =
  match fs.openPDF("report.pdf")
  case Err(error) => println: error
  case Ok(pdf) =>
    println: "\{pdf.pageCount} pages"

    match pdf.pageText(1)
    case Ok(text)   => println: text
    case Err(error) => println: error

    pdf.close()
```

Pages are 1-based. Close the handle when finished.

## Navigate before reading

For a long document, inspect its outline and metadata before extracting text.
The outline maps headings to page numbers, so generated code can read only the
pages around the relevant section.

## Inspect visual content

The page content profile counts text runs, embedded images, and vector paths. It
is a cheap signal:

- no text and an image often means a scanned page
- images alongside text indicate figures worth inspecting
- many paths often indicate tables or diagrams

PDF does not contain a general table abstraction, so Harpe does not pretend to
extract one.

`pageImage(page, target, scale)` renders a page to PNG in the data directory.
Use it for OCR or when the chat model needs to inspect the page visually.

## Implementation

The shipped runtime binds the `PdfReader` interface to `PdfiumReader`, backed by
`pypdfium2`:

```jo
pdfReader = new PdfiumReader(root)
```

Replace that binding in `SandboxRuntime.jo` to use another implementation.
Generated code continues to use `fs.openPDF` and the `PDF` interface.

## Interface reference

```jo
class Heading(title: String, page: Int, level: Int)
class PageContent(texts: Int, images: Int, paths: Int)

interface PdfReader
  def open(src: String): Result[PDF, String]
end

interface PDF
  def pageCount: Int
  def outline: List[Heading]
  def metadata: Map[String, String]
  def pageText(page: Int): Result[String, String]
  def pageContent(page: Int): PageContent
  def pageImage(page: Int, target: String, scale: Int = 2): Result[Image.Size, String]
  def close(): Unit
end

param pdfReader: PdfReader
```
