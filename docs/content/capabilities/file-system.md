+++
title = "File System"
+++
File-system support has three interfaces:

- `FileSystem` is the confined, read/write directory tree.
- `TextFile` is an open handle for whole, windowed, or lazy line reads.
- `BinaryFile` is an open handle for byte reads and writes.

The application defines the root of the file system.

All paths are portable and relative. `""` names the root. Absolute paths,
parent traversal, backslashes, drive prefixes, and empty path segments are
rejected. `exists` and `isFile` return `false` for an invalid path. Operations
that provide diagnostics return `Err`.

## Inspect the tree

```jo
def runTask(): Unit receives stdout, fs =
  match fs.list("")
  case Err(error) => println: error
  case Ok(entries) =>
    for entry in entries do
      println: entry.path
```

Listings are sorted and identify directories without an extra metadata call.
Use `stat` when size or modification time matters.

## Small files

Use the one-shot helpers when loading the whole file is reasonable:

```jo
match fs.readText("notes.txt")
case Ok(text)   => println: text
case Err(error) => println: error

match fs.writeText("summary.txt", "Finished")
case Ok(_)      => println: "Saved"
case Err(error) => println: error
```

`readText` supports `"utf-8"` and `"windows-1252"`. Undecodable bytes become
U+FFFD rather than crashing the run.

`readBytes` reads a whole binary file. `writeText` replaces or creates a
UTF-8 file and creates missing parent directories.

## Large files

Open a handle to avoid loading the whole file. Text can be read by head, tail,
or a lazy line iterator; binary files support random-access reads and writes.
Close handles when finished.

```jo
match fs.openTextFile("logs/app.log")
case Err(error) => println: error
case Ok(log) =>
  for line in log.lines do
    if line.contains("ERROR") then println: line
  log.close()
```

Invalid paths and environment failures are returned as `Result`. Contract violations,
such as a negative offset or reading a closed handle, abort the generated
program.

## Document shortcuts

`FileSystem` also provides `openPDF`, `openWorkbook`, and `openWord`. Each
delegates to the corresponding reader capability bound by the trusted runtime.

See [PDF](/capabilities/pdf/), [Excel](/capabilities/excel/), and
[Word](/capabilities/word/).

## Interface reference

```jo
interface FileSystem
  def exists(path: String): Bool
  def isFile(path: String): Bool
  def stat(path: String): Result[Option[FileSystem.Info], String]
  def list(dir: String): Result[List[FileSystem.Entry], String]

  def openTextFile(path: String, encoding: String = "utf-8"): Result[TextFile, String]
  def openBinaryFile(path: String): Result[BinaryFile, String]
  def openPDF(path: String): Result[PDF, String] receives pdfReader
  def openWorkbook(path: String): Result[Workbook, String] receives excelReader
  def openWord(path: String): Result[Word, String] receives wordReader

  def readText(path: String, encoding: String = "utf-8"): Result[String, String]
  def readBytes(path: String): Result[Bytes, String]
  def writeText(path: String, content: String): Result[Unit, String]
  def createBinaryFile(path: String): Result[BinaryFile, String]
end

interface TextFile
  def text: String
  def lines: Iterator[String]
  def head(count: Int): List[String]
  def tail(count: Int): List[String]
  def size: Int
  def close(): Unit
end

interface BinaryFile
  def bytes: Bytes
  def read(offset: Int, length: Int): Bytes
  def size: Int
  def write(offset: Int, data: Bytes): Unit
  def close(): Unit
end

param fs: FileSystem

section FileSystem
  class Info(isFile: Bool, sizeBytes: Int, modifiedAt: Int)
  class Entry(path: String, isDirectory: Bool)
end
```
