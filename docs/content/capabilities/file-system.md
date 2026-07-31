+++
title = "FileSystem"
+++
`FileSystem` gives generated code a confined, read/write directory tree. The
application chooses its root; the CLI, Web, and Telegram templates bind it to
the current session's data directory.

All paths are portable and relative. `""` names the root. Absolute paths,
parent traversal, backslashes, drive prefixes, and empty path segments are
rejected.

## Inspect the tree

```jo
def runTask(): Unit receives stdout, fs =
  match fs.list("")
  case Err(error) => println: error
  case Ok(entries) =>
    for entry in entries do
      println: entry.path
```

The core metadata operations are:

- `exists(path)`
- `isFile(path)`
- `stat(path)` → `Option[FileInfo]`
- `list(dir)` → sorted `List[DirEntry]`

`FileInfo` contains `isFile`, `sizeBytes`, and `modifiedAt`. `DirEntry` contains
the child path and whether it is a directory.

## Small files

Use the one-shot helpers when loading the whole file is reasonable:

```jo
match fs.readText("notes.txt")
case Ok(text)   => println: text
case Err(error) => println: error

fs.writeTextFile("summary.txt", "Finished")
```

`readText` supports `"utf-8"` and `"windows-1252"`. Undecodable bytes become
U+FFFD rather than crashing the run.

`readBytes` reads a whole binary file. `writeTextFile` replaces or creates a
UTF-8 file and creates missing parent directories.

## Large files

Open a handle to avoid loading the whole file:

- `TextFile.text`, `head`, `tail`, and lazy `lines`
- `BinaryFile.bytes` and random-access `read`
- `BinaryFile.write` for generated binary files

Close handles when finished.

```jo
match fs.openTextFile("logs/app.log")
case Err(error) => println: error
case Ok(log) =>
  for line in log.lines do
    if line.contains("ERROR") then println: line
  log.close()
```

Environment failures are returned as `Result` or `Option`. Contract violations,
such as a negative offset or reading a closed handle, abort the generated
program.

## Document shortcuts

`FileSystem` also provides `openPDF`, `openWorkbook`, and `openWord`. Each
delegates to the corresponding reader capability bound by the trusted runtime.

See [PDF](/capabilities/pdf/), [Workbook](/capabilities/workbook/), and
[Word](/capabilities/word/).
