# Changelog

## 0.1.0 — 2026-08-05

Initial developer-preview release of Harpe, a typed, capability-constrained
agent framework for Jo.

### harpe-caps 0.1.0

- Pure Jo capability interfaces for files, paths, documents, workbooks, images,
  OCR, PDFs, media, and binary data.
- A sandbox-safe API surface with no FFI dependency.

### harpe 0.1.0

- Core agent loop with OpenAI, Anthropic, and OpenRouter model support.
- Compile-time capability restriction for model-generated Jo programs.
- Sandboxed task execution with trusted host-side capability implementations.
- Context compaction, persistent sessions, memory, logging, tools, skills, and
  media handling.
- CLI, web, Telegram, and minimal learning-agent applications.
- File, document, spreadsheet, image, OCR, and PDF capabilities.

This release is intended for developer preview. Applications performing
irreversible actions should keep those actions read-only, queued, or protected
by trusted approval code.
