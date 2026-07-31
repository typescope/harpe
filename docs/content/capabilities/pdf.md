+++
title = "PDF"
+++
`PDF` exposes a document page by page. It avoids turning an entire report into
one large string and lets generated code inspect only the relevant pages.

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

- `pageCount` returns the number of pages.
- `outline` returns headings with a title, page, and nesting level.
- `metadata` returns the PDF information dictionary.
- `pageText(page)` extracts one page's text.

For a long document, inspect the outline first and read only the pages around
the relevant heading.

## Inspect visual content

`pageContent(page)` reports the number of text runs, embedded images, and vector
paths. It is a cheap signal:

- no text and an image often means a scanned page
- images alongside text indicate figures worth inspecting
- many paths often indicate tables or diagrams

PDF does not contain a general table abstraction, so Harpe does not pretend to
extract one.

`pageImage(page, target, scale)` renders a page to PNG in the data directory.
Use it for OCR or when the chat model needs to inspect the page visually.

The shipped runtime binds `PdfiumReader`, backed by `pypdfium2`. Replace the
reader in `SandboxRuntime.jo` to use another implementation.
