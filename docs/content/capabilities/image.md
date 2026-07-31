+++
title = "Image"
+++
`Image` inspects and transforms image files in the agent's data directory. It
handles pixels, not text recognition.

```jo
def runTask(): Unit receives stdout, image =
  match image.dimensions("photo.jpg")
  case Err(error) => println: error
  case Ok(size) =>
    println: "\{size.width} × \{size.height}"

    match image.resize("photo.jpg", 1200, 1200, "photo-small.jpg")
    case Ok(result) => println: "Wrote \{result.width} × \{result.height}"
    case Err(error) => println: error
```

The capability provides:

- `dimensions(src)`
- `metadata(src)` — format, mode, and available EXIF fields
- `resize(src, width, height, target)` — preserves aspect ratio and never enlarges
- `crop(src, x, y, width, height, target)`
- `convert(src, target)` — chooses the output format from the target extension

Every output is written to a relative target path in the same confined data
directory.

Use [OCR](/capabilities/ocr/) to extract text. Use the framework's
`uploadMedia` tool when the chat model needs to inspect the actual pixels.

The shipped implementation is `PillowImage`, backed by Pillow.
