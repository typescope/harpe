+++
title = "Overview"
+++
Harpe provides a set of typed capabilities for common agent work:

- a confined [file system](/capabilities/file-system/)
- [PDF](/capabilities/pdf/), [Excel](/capabilities/excel/), and
  [Word](/capabilities/word/) readers
- [Image](/capabilities/image/) operations
- [OCR](/capabilities/ocr/)

The interfaces live in the pure `harpe-caps` module. Generated code can compile
against their types, but it cannot reach their implementations, Python FFI, or
the host environment.

## Choose the grant

An agent grants capabilities in `sandbox/SandboxAPI.jo`:

```jo
defer def runTask(): Unit receives
  stdout, fs, pdfReader, excelReader, wordReader, image, ocr
```

Remove anything the agent does not need. If generated code names an unavailable
capability, compilation fails before the program runs.

The minimal `hello` template grants only `stdout`. The larger application
templates include the framework capabilities above as useful defaults.

## Choose the implementation

Trusted implementations are constructed and bound in
`sandbox/SandboxRuntime.jo`. You can replace a backend without changing the
guest-facing interface—for example, bind a different OCR engine or PDF reader.

Keep credentials, provider SDKs, tenant scope, and validation in the trusted
implementation. Give generated code only the narrow interface.

## Define application capabilities

Framework capabilities cover files and common document formats. Specialized
agents should expose domain operations such as customer lookup, ticket updates,
or payment preparation through their own typed interfaces.

Follow [Create a Custom Capability](/tutorial/create-custom-capabilities/) to
define the interface, implement it in trusted code, bind it in the runtime, and
verify that undeclared authority does not compile.
