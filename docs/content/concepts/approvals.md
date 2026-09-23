+++
title = "Human Approval"
+++
Human approval is a human-in-the-loop check before an agent performs a specific
operation. An agent might prepare a payment, for example, while every transfer
still requires confirmation.

Approval is an application interaction. Unlike regular model prompt confirmation, the request is initiated by trusted tools or capabilities, not by the model. It's guaranteed by design that the model cannot approve its own action. The code responsible for the operation waits for the user's decision and performs the effect only when the decision is `Approved`.

## Where approval happens

An agent can reach an operation through a host-side tool or through generated
code. Harpe supports approval in both paths:

![A host-side tool requests approval directly through Interact. Generated code requests approval through a trusted capability and the runCode broker. Interact presents both requests to the user.](/img/approval-flow.svg)

A host-side tool asks through the turn's `Interact`. A trusted code-mode
capability asks through `Approvals`. The `runCode` broker carries that request
back to the same `Interact` used by the turn. Both cases put the approval check in the trusted code that performs the
effect.

## Approval from a tool

Every tool handler receives the active `Interact`. A tool can use it immediately
before a consequential operation:

```jo
def transfer(input: Transfer, interact: Interact): ToolOutcome =
  val decision = interact.approve:
    "Transfer funds"
    "Transfer **CHF \{input.amount}** to **\{input.recipient}**."

  match decision
  case Approvals.Approved =>
    executeTransfer(input)

  case Approvals.Rejected =>
    failedTransfer("The transfer was rejected.")

  case Approvals.TimedOut =>
    failedTransfer("Approval timed out.")

  case Approvals.Cancelled =>
    failedTransfer("Approval was cancelled.")
```

The handler receives `Interact` through its toolset wiring:

```jo
def toolset(): Toolset =
  Toolset.of: this, (input: ToolInput, interact: Interact) =>
    transfer(parseTransfer(input), interact)
```

The tool should return a failed `ToolOutcome` for rejection, timeout, or
cancellation. That result tells the model why the operation did not happen and
lets it respond appropriately.

When a tool runs with `Interact.unattended`, approval returns
`Approvals.Cancelled` because no user is available to decide.

## Approval from generated code

Generated code does not receive `Interact` or direct access to approval. It
calls a domain capability such as `Payments`. The trusted implementation of that
capability decides which operations require approval:

```jo
class PaymentsImpl(approvals: Approvals)
  view Payments

  def transfer(input: Transfer): Result[Receipt, String] =
    val decision = approvals.request:
      "Transfer funds"
      "Transfer **CHF \{input.amount}** to **\{input.recipient}**."

    match decision
    case Approvals.Approved =>
      executeTransfer(input)
    case Approvals.Rejected =>
      Err("The transfer was rejected.")
    case Approvals.TimedOut =>
      Err("Approval timed out.")
    case Approvals.Cancelled =>
      Err("Approval was cancelled.")
end
```

The generated program can request `payment.transfer`, but it cannot remove the
approval check or approve the request. Those decisions stay in the trusted
runtime on the other side of the [capability boundary](/concepts/sandbox/).

The sandbox runtime connects `Approvals` to the `runCode` broker. The broker
forwards the title and detail to `Interact`. If generated code runs without a
broker, approval returns `Approvals.Cancelled`.

## The two approval interfaces

Tools and code-mode capabilities enter the flow through different interfaces:

```jo
interface Interact
  def approve(title: String, detail: String): Approvals.Decision
end

interface Approvals
  def request(title: String, detail: String): Approvals.Decision
end
```

Both take the request as its two fields, a title and a Markdown detail, and
neither carries an ID. `Interact.approve` belongs to the active turn: the
application implements it to show a request to the user and wait for a decision.
An interface that answers out of band — a browser tab posting a decision back, a
Telegram callback button — needs a correlation ID to match that decision to the
request it answers, and mints one of its own. `Approvals.request` belongs to the
sandbox runtime. Its broker adapts a capability request to the active
interaction.

Approval remains outside the model conversation in both paths. It does not
consume model context or appear in the transcript when a conversation is
resumed. An application can still log requests and decisions for auditing.

## Interaction and timeouts

The application controls how long its interaction waits. A timeout is different
from rejection because the user never made a decision.

For generated code, `runCode` also has an approval deadline as a watchdog. Set
it slightly longer than the interaction deadline. This prevents a broken
interaction implementation from leaving the sandbox process waiting forever.

Harpe approval is synchronous. The tool handler or generated program remains
active while it waits. An approval that may take hours, involve another person,
or survive a process restart needs a durable application workflow instead.

## Designing an approval request

- Enforce approval in the host tool or trusted capability that performs the
  operation.
- Build the request from validated operation arguments.
- Describe the exact effect and the important values the user should verify.
- Keep the title short and put supporting context in the Markdown detail.
- Perform the effect immediately after `Approved` so the request still describes
  the operation being executed.
- Handle rejection, timeout, and cancellation explicitly.
- Make the operation idempotent when a retry could otherwise perform it twice.
