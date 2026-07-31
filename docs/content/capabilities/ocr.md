+++
title = "OCR"
+++
`OCR` extracts text from an image in the agent's data directory:

```jo
def runTask(): Unit receives stdout, ocr =
  match ocr.text("scan.png")
  case Ok(text)   => println: text
  case Err(error) => println: error
```

`Ok("")` means the image contained no recognized text. `Err` means the image
could not be read or the OCR engine was unavailable.

OCR is a separate capability from [Image](/capabilities/image/). An application
can allow pixel transformations without allowing content extraction, and it can
replace the OCR engine independently.

## Scanned PDFs

Render the page first, then recognize it:

```jo
def runTask(): Unit receives stdout, fs, pdfReader, ocr =
  match fs.openPDF("scan.pdf")
  case Err(error) => println: error
  case Ok(pdf) =>
    match pdf.pageImage(1, "page-1.png")
    case Err(error) => println: error
    case Ok(_) =>
      match ocr.text("page-1.png")
      case Ok(text)   => println: text
      case Err(error) => println: error

    pdf.close()
```

CLI and Web bind `TesseractOcr`. Telegram binds `RapidOcr`. Change the binding
in `SandboxRuntime.jo` to select another implementation.

## Interface reference

```jo
interface OCR
  def text(src: String): Result[String, String]
end

param ocr: OCR
```
