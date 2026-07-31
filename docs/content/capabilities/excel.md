+++
title = "Excel"
+++
Excel support has two interfaces:

- `ExcelReader` opens an `.xlsx` file.
- `Workbook` is the open, sheet-wise handle it returns.

`FileSystem.openWorkbook` is a shortcut through the ambient `excelReader`
capability. Generated code can inspect a large workbook without putting every
cell into model context.

```jo
def runTask(): Unit receives stdout, fs, excelReader =
  match fs.openWorkbook("orders.xlsx")
  case Err(error) => println: error
  case Ok(book) =>
    for sheet in book.sheets do println: sheet

    match book.rows("Orders", 1, 20)
    case None       => println: "No Orders sheet"
    case Some(rows) =>
      for row in rows do println: row.join(" | ")

    book.close()
```

Rows are 1-based. Close the workbook when finished.

Inspect a sheet's dimensions before choosing a row window. An unknown sheet
returns `None`; a window beyond the end reads short. Cells are rendered as
strings, with empty cells returned as `""`.

The shipped `OpenpyxlExcel` backend opens workbooks in read-only streaming mode
and returns cached formula values rather than formulas. It is backed by
`openpyxl`:

```jo
excelReader = new OpenpyxlExcel(root)
```

Replace the `ExcelReader` binding in `SandboxRuntime.jo` to use another
implementation. Generated code continues to use `fs.openWorkbook` and the
`Workbook` interface.

## Interface reference

```jo
class SheetSize(rows: Int, columns: Int)

interface ExcelReader
  def open(src: String): Result[Workbook, String]
end

interface Workbook
  def sheets: List[String]
  def dimensions(sheet: String): Option[SheetSize]
  def rows(sheet: String, start: Int, count: Int): Option[List[List[String]]]
  def close(): Unit
end

param excelReader: ExcelReader
```
