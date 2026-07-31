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

Resize preserves aspect ratio and never enlarges the source. Conversion chooses
the output format from the target extension. Every derived image is written to
a relative target path in the same confined data directory.

Use [OCR](/capabilities/ocr/) to extract text. Use the framework's
`uploadMedia` tool when the chat model needs to inspect the actual pixels.

The shipped implementation is `PillowImage`, backed by Pillow.

## Interface reference

```jo
class ImageSize(width: Int, height: Int)

interface Image
  def dimensions(src: String): Result[ImageSize, String]
  def metadata(src: String): Result[Map[String, String], String]
  def resize(src: String, width: Int, height: Int, target: String): Result[ImageSize, String]
  def crop(src: String, x: Int, y: Int, width: Int, height: Int, target: String): Result[ImageSize, String]
  def convert(src: String, target: String): Result[ImageSize, String]
end

param image: Image
```
