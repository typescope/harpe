+++
title = "Workbook"
+++
`Workbook` reads Excel `.xlsx` files sheet by sheet and row window by row
window. Generated code can inspect a large workbook without putting every cell
into model context.

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

The interface provides:

- `sheets` — names in workbook order
- `dimensions(sheet)` — row and column counts
- `rows(sheet, start, count)` — a window of cells rendered as strings

An unknown sheet returns `None`. A window beyond the end reads short. Empty
cells are returned as `""`.

The shipped `OpenpyxlExcel` backend opens workbooks in read-only streaming mode
and returns cached formula values rather than formulas. It is backed by
`openpyxl`.
