+++
title = "Turn"
+++
A turn is the complete exchange from one user message to a final answer,
including every model request, tool call, retry, and context update along the
way. `Agent.ask` coordinates it. The driver supplies an `Interact` channel to
observe progress and handle cancellation and approvals.

## Turn execution

A turn begins when your application passes a user message to `Agent.ask`. Harpe
asks the model what to do next. The model can answer the user or request one or
more tools.

![A turn gathers context, asks the model for either a tool call or a final answer, executes each requested tool, and returns its result to the model until the turn is complete.](/img/how-a-turn-works.svg)

When the model requests a tool, Harpe runs it and sends the result back to the
model. The model can then request another tool or produce a final answer. This
loop continues until the turn finishes, fails, or is cancelled.

From your application's perspective, the whole exchange is one call:

```jo
val turn = Agent.ask:
  message
  brain = brain
  tools = tools
  interact = channel
  context = context
```

`TurnData` contains the final outcome and the messages produced during the
turn. While the call is running, `Interact` reports progress such as streamed
text, tool execution, and retries. Your driver decides how to display those
updates and what to do with the completed turn.

## Interaction contract

```jo
interface Interact
  def cancelled: Bool
  def pause(seconds: Float): Bool
  def emit(event: TurnEvent): Unit
  def approve(id: String, request: Approvals.Request): Approvals.Decision
end
```

- `cancelled` lets the turn engine, model streams, and tool loop stop
  cooperatively.
- `pause` waits during retry backoff. It returns `true` when cancellation ends
  the wait early.
- `emit` reports non-terminal progress through the events listed below.
- `approve` asks the active user to allow or reject a protected action. The
  request id prevents a stale decision from approving a later action.

Drivers implement this interface for their transport and user interface.
`Interact.unattended` provides a channel that ignores events, never cancels,
and treats approval as cancelled.

Passing the channel to the model session lets a streaming adapter stop reading
promptly when the turn is cancelled. It also leaves room for future
provider-derived progress events. Lifecycle and tool events remain owned by the
turn engine. Provider adapters emit only information obtained while reading the
provider stream.

## Turn events

`Interact.emit` receives non-terminal `TurnEvent` values. Completion,
interruption, and failure are represented by the turn's `TurnResult`, not by an
event.

| Event | Meaning |
| --- | --- |
| `ModelRequestStarted(attempt, maxAttempts)` | A model request is about to block. Attempt zero is the initial request. |
| `ModelRequestEnded` | The current model request returned. |
| `TransientError(detail, delaySeconds)` | A retryable request failed and the turn is about to wait. |
| `AssistantChunk(text)` | Provisional visible text arrived from the active provider request. |
| `AssistantStreamReset` | Discard provisional chunks because their request failed and will not be committed. |
| `AssistantMessage(text)` | A complete assistant message preceding tool calls is available. |
| `ToolBudgetReached(budget)` | No more tools are being offered. The model must produce a final answer. |
| `ToolCallStarted(name)` | Execution of a requested tool has begun. |
| `ToolCallEnded(name, summary)` | Tool execution ended with a driver-facing summary. |
| `ContextCompacted(droppedMessages)` | Context compacted older messages before a model request. |

## Chunk streaming

The built-in model adapters read their provider streams synchronously. They
emit `AssistantChunk` as text arrives and still return one complete
`ReplyResult`.

A driver can display the provisional text with a small `Interact`
implementation:

```jo
private class LiveInteract(render: String => Unit)
  view Interact

  private var provisional: String = ""

  def cancelled: Bool = false
  def pause(seconds: Float): Bool = false

  def emit(event: TurnEvent): Unit =
    match event
    case TurnEvent.AssistantChunk(text) =>
      provisional = provisional + text
      render(provisional)

    case TurnEvent.AssistantStreamReset =>
      provisional = ""
      render(provisional)

    case _ => pass

  def approve(id: String, request: Approvals.Request): Approvals.Decision =
    Approvals.Cancelled
end
```

Pass the channel to the turn as usual:

```jo
val channel = new LiveInteract(text => updateAnswer(text))

val turn = Agent.ask:
  "Explain the result"
  brain = brain
  interact = channel
```

Chunks are presentation data, not transcript messages. A driver may append them
to a provisional answer, ignore them, or translate them for its transport. When
`AssistantStreamReset` arrives, it must remove that provisional attempt. The
event prevents text from a failed request being concatenated with its retry. The
complete `TurnData` remains the authoritative result for persistence and final
rendering.
