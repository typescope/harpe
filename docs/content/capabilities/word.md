+++
title = "Word"
+++
`Word` reads `.docx` files as paragraphs and headings. Word documents do not
have stable pages—the pagination depends on rendering—so the capability exposes
their logical structure instead.

```jo
def runTask(): Unit receives stdout, fs, wordReader =
  match fs.openWord("proposal.docx")
  case Err(error) => println: error
  case Ok(doc) =>
    for heading in doc.outline do
      println: "\{heading.level}: \{heading.title}"

    for paragraph in doc.paragraphs(1, 20) do
      println: paragraph

    doc.close()
```

Paragraphs are 1-based. Close the document when finished.

The interface provides:

- `paragraphCount`
- `outline` — heading title, paragraph index, and level
- `paragraphs(start, count)` — a paragraph window

Use the outline to locate a section before reading its paragraphs.

The shipped `DocxReader` backend uses `python-docx`. It extracts paragraph text
and styles; it is not a full Word renderer.
