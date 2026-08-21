+++
title = "Word"
+++
Word support has two interfaces:

- `WordReader` opens a `.docx` file.
- `Word` is the open, paragraph-wise handle it returns.

`FileSystem.openWord` is a shortcut through the ambient `wordReader` capability.
Word documents do not have stable pages—the pagination depends on rendering—so
`Word` exposes their logical structure instead.

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

The outline maps headings to paragraph indices. Use it to locate a section
before reading a paragraph window.

The shipped runtime binds `WordReader` to `DocxReader`, backed by `python-docx`:

```jo
wordReader = new DocxReader(root)
```

It extracts paragraph text and styles; it is not a full Word renderer. Replace
the binding in `SandboxRuntime.jo` to use another implementation.

## Interface reference

```jo
interface WordReader
  def open(src: String): Result[Word, String]
end

interface Word
  def paragraphCount: Int
  def outline: List[Word.Heading]
  def paragraphs(start: Int, count: Int): List[String]
  def close(): Unit
end

param wordReader: WordReader

section Word
  class Heading(title: String, paragraph: Int, level: Int)
end
```
