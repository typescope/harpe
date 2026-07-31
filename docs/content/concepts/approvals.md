+++
title = "Human approval"
+++
Compile-time capabilities decide which operations generated programs may call.
Human approval decides whether one particular operation should proceed.

Harpe supports **instant approval** during an active agent run. The session user is
also the approver. CLI, Web, and Telegram present the request in their native
interfaces and choose how long to wait.

## The approval boundary

Approval belongs in the trusted implementation of an irreversible capability. The
generated program may ask that capability to perform an operation, but it cannot
remove the approval requirement or approve its own request.

```jo
class PaymentsImpl(approvals: Approvals)
  view Payments

  def transfer(input: Transfer): Result[Receipt, String] =
    val request = ApprovalRequest(
      "Transfer funds",
      "Transfer **CHF \{input.amount}** to **\{input.recipient}**."
    )

    match approvals.request(request)
    case Approved =>
      executeTransfer(input)
    case Rejected =>
      Err("The transfer was rejected.")
    case ApprovalTimedOut =>
      Err("Approval timed out.")
    case ApprovalCancelled =>
      Err("Approval was cancelled.")
end
```

The implementation creates the request from validated action arguments. It
performs the effect only after receiving `Approved`.

## Request and decision types

An approval request has a short plain-text title and Markdown detail:

```jo
class ApprovalRequest(title: String, detail: String)

interface Approvals
  def request(request: ApprovalRequest): ApprovalDecision
end
```

The decision distinguishes four outcomes:

```jo
union ApprovalDecision =
    Approved
  | Rejected
  | ApprovalTimedOut
  | ApprovalCancelled
```

Timeout is not rejection. Cancellation means the enclosing agent run or
interaction ended before a decision was made.

## Runtime wiring

The sandbox runtime opens one broker connection when it starts and binds the
implementation as an ambient capability:

```jo
def main(): Unit receives stdout =
  with approvals = BrokerApprovals.connect() in
    run()
```

Trusted capability implementations can receive or capture `approvals` when the
runtime constructs them:

```jo
private def run(): Unit receives stdout, approvals =
  val payments = new PaymentsImpl(approvals)

  with payment = payments in
    sandbox.api.runTask()
```

The generated guest receives `payment`, not `approvals`. Approval policy therefore
stays in trusted runtime code.

`BrokerApprovals` keeps one connection for the sandbox program and serializes
requests over it. When a runtime is launched outside `runCode` and has no broker,
approval requests return `ApprovalCancelled`.

## Interaction flow

Approval travels outside the model conversation:

```text
sandbox capability
       │ request
       ▼
     broker
       │
       ▼
     agent
       │
       ▼
    Interact
       │
       ▼
 CLI, Web, or Telegram

 decision returns along the same path
```

The agent assigns a unique ID to each request and binds the decision to the active
run and session. The request and decision do not enter the transcript, consume
model context, or appear when the conversation is resumed.

They may still be written to the application log for auditing.

## Driver behavior

- CLI displays the title and rendered Markdown, then accepts a single-key decision.
- Web streams an approval card with Approve and Reject buttons. A reconnected tab
  receives the pending request.
- Telegram sends inline buttons. Only the user who initiated the turn can decide.

The approval deadline belongs to the application. The shipped CLI, Web, and
Telegram applications wait for at most 10 minutes. Stale and duplicate decisions
are ignored.

Approval wait time is accounted separately from guest execution time. Waiting for
a person does not consume the program's execution budget, and it does not give a
busy program additional runtime.

The framework does not choose the deadline. The application passes an approval
deadline to `runCode` as a watchdog. It should be slightly longer than the
interaction deadline. This ensures a broken interaction handler cannot leave the
sandbox waiting forever.

## Instant and delayed approval

Instant approval assumes the current session user can decide promptly. It keeps
the sandboxed program active and returns the decision to the waiting capability
call.

Delayed approval is a different application workflow. It may involve another
person and take hours or days. The Web application can later represent it as a
durable work request with an associated conversation. Delayed approval is not part
of the current framework primitive.

## Designing an approval

- Require approval in trusted capability code.
- Describe the exact operation and important arguments.
- Keep the title short and put context in the Markdown detail.
- Execute the effect immediately after approval.
- Treat rejection, timeout, and cancellation separately.
- Make the underlying operation idempotent when retries could duplicate it.
- Do not use approval as a substitute for narrow capability interfaces.
