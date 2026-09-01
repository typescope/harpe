+++
title = "Turn"
+++
A turn is everything Harpe does in response to one user message. It begins with
the message and ends with an answer, a failure, or a cancellation. Along the
way, the model may call tools and use their results before it answers.

## Turn execution

A turn begins when your application passes a user message to `Agent.ask`. Harpe
asks the model what to do next. The model can answer the user or request one or
more tools.

![A user message goes to the model. A final answer completes the turn. A tool call runs the requested tool and sends its result back to the model.](/img/how-a-turn-works.svg)

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

The returned `TurnData` tells your application how the turn ended and contains
the messages it produced. While the turn is running, `Interact` reports live
progress such as streamed text, tool execution, and retries. Your application
decides which updates to show and how to store or present the completed turn.

## Tool call scheduling

A model may request several tools in one reply. How those calls run is your
application's choice, passed to `Agent.ask` as a `ToolCallExecutor`:

```jo
val turn = Agent.ask:
  message
  tools = tools
  executor = ToolCallExecutor.parallel(4)
```

`ToolCallExecutor.sequential` is the default. It runs one call at a time, in the
order the model asked, which is the only policy that is safe for every toolset.

`ToolCallExecutor.parallel(maxConcurrent)` runs up to `maxConcurrent` calls at
once. Results still come back in call order, so the model always sees them
paired with the calls it made. Use it when your handlers are independent and
spend their time waiting — a page fetch, a sandbox run, a sub-agent turn.

Choosing the parallel policy is a promise about your own code. Your handlers
must tolerate running at the same time, and so must the `Interact` you pass in.
Harpe calls `emit` from several threads under this policy, and two handlers can
reach `approve` at once with only one user to answer them. Serializing that
belongs in your `Interact`, where the knowledge of how your interface behaves
already lives. Logging needs no such care, because Harpe installs a serializing
logger for you.

## Interaction contract

`Interact` connects an active turn to your application's user interface. Harpe
uses it to report progress, check for cancellation, wait between retries, and
request approval for protected actions.

```jo
interface Interact
  def cancelled: Bool
  def pause(seconds: Float): Bool
  def emit(event: TurnEvent): Unit
  def approve(title: String, detail: String): Approvals.Decision
end
```

- `cancelled` tells Harpe that the user wants to stop the turn.
- `pause` waits before retrying a temporary failure. It returns `true` if the
  user cancels while waiting.
- `emit` reports progress through the events listed below.
- `approve` asks the active user to allow or reject a protected action.

Your application implements this interface for its transport and user
interface.
`Interact.unattended` provides a channel that ignores events, never cancels,
and treats approval as cancelled.

## Turn events

`Interact.emit` receives `TurnEvent` values while work is in progress. The
completed `TurnData` carries the final success, interruption, or failure.

| Event | Meaning |
| --- | --- |
| `ModelRequestStarted(attempt, maxAttempts)` | Harpe started a model request. Attempt zero is the first request. |
| `ModelRequestEnded` | Harpe finished receiving the model response. |
| `TransientError(detail, delaySeconds)` | A temporary model error occurred. Harpe will wait and retry. |
| `AssistantChunk(text)` | A new piece of the assistant's answer is ready to display. |
| `AssistantStreamReset` | Clear text from a failed streaming attempt before its retry begins. |
| `AssistantMessage(text)` | The assistant produced visible text before requesting tools. |
| `ToolBudgetReached(budget)` | The turn used its tool-call budget. Harpe now asks for a final answer. |
| `ToolCallStarted(name)` | Harpe started running a tool. |
| `ToolCallEnded(name, summary)` | The tool finished and produced a displayable summary. |
| `ContextCompacted(droppedMessages)` | Older conversation messages were compacted to keep the context manageable. |

## Chunk streaming

Harpe can display an answer while the model is still generating it. The
built-in model providers emit `AssistantChunk` events as text arrives. The
completed turn still contains the full answer.

An application can display the provisional text with a small `Interact`
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

  def approve(title: String, detail: String): Approvals.Decision =
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

Chunks are live display updates, not separate conversation messages. Your
application can show them or ignore them. When `AssistantStreamReset` arrives,
clear the text from that attempt so it is not joined with the retry. Use the
complete `TurnData` for persistence and final rendering.
