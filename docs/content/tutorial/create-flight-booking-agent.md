+++
title = "Create a Flight Booking Agent"
+++
The flight booking example is a web app, named **Sky**, that searches for
flights and places orders through the [Duffel](https://duffel.com/docs) API. It
is the example to read for one reason above the others: booking is an
irreversible action, so the capability that performs it asks a human first.

Everything runs against Duffel's test mode. No real flights are booked and no
money is charged.

## Create the project

```sh
jo new my-booker --template typescope/harpe:flight-booker
cd my-booker
pip install -r requirements.txt
cp .env.example .env
```

You need two credentials:

- A Duffel test API key from [app.duffel.com](https://app.duffel.com), under
  **Developers → API keys**. It starts with `duffel_test_`.
- A model provider key.

```sh
DUFFEL_API_KEY=duffel_test_...
ANTHROPIC_API_KEY=...
MODEL=claude-opus-4-6
```

Start the web app:

```sh
jo start
```

Then open [http://127.0.0.1:8765](http://127.0.0.1:8765) in your browser.
Describe a trip — "a flight from London to New York on October 1st" — and Sky
searches, presents the cheapest offers, and collects passenger details in
conversation.

## Booking asks before it acts

The generated program calls `duffel.createOrder(...)` like any other operation.
It has no way to know that the call pauses, and no way to skip the pause, because
the request is made inside the trusted implementation in `sandbox/DuffelClient.jo`:

```jo
val decision = approvals.request(new Approvals.Request("Confirm booking", summary))
if decision is !Approvals.Approved then
  return new api.OrderConfirmation("", "", "", "", "Booking " + Approvals.wire(decision))
```

The summary is built from the offer and the passenger names the implementation
already validated, not from text the model supplied. The order is placed only
after `Approvals.Approved`.

Three pieces connect that request to a button in the chat:

- `sandbox/Runtime.jo` opens the channel with `BrokerApprovals.connect()` and
  binds it before running the guest, so the paused program is waiting on the
  host.
- `src/Interact.jo` implements `approve`, rendering an **Approve / Reject**
  card in the browser and blocking until the user clicks one.
- The decision travels back as `Approved`, `Rejected`, `TimedOut`, or
  `Cancelled`.

A rejection is not an error. It arrives in the program as
`confirmation.error` set to `"Booking rejected"`, which the model reads and
turns back into conversation — asking what to change and searching again.

This is the pattern described in [Human approval](/concepts/approvals/), applied
to a real irreversible operation. Compile-time capabilities decide that the
program *may* book a flight. The approval decides whether *this* booking
proceeds.

## What to customize

```text
my-booker/
  AGENT.md               # Sky's booking workflow and reply formatting
  src/
    Main.jo              # startup, credential checks, and HTTP server
    Session.jo           # per-session state and the agent turn
    Server.jo            # HTTP routing
    Interact.jo          # turn events and the browser approval card
  sandbox/
    API.jo               # the Duffel capability a generated program may call
    DuffelClient.jo      # the implementation, and where approval lives
    Runtime.jo           # broker connection and capability binding
    Task.jo              # the guest entry point runCode overwrites each turn
  skills/
    api.jo               # capability reference the model reads on demand
  assets/
    index.html           # the web UI
```

- Edit `AGENT.md` to change the booking workflow, the offer formatting, or how
  much Sky asks before searching.
- Edit `sandbox/API.jo` to change what the agent may do — add seat selection,
  or remove `createOrder` to make the app search-only — then update
  `DuffelClient.jo` to match.
- Edit the approval summary in `DuffelClient.jo` to change what the user sees
  before confirming. Build it from validated arguments, never from model text.
- Edit `src/Interact.jo` to change how the approval card looks or how long it
  waits.
