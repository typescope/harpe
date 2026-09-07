+++
title = "Flight Booking"
aliases = ["/tutorial/create-flight-booking-agent/"]
+++
**Sky** is a web app that searches for flights and places orders through the
[Duffel](https://duffel.com/docs) API. It is the smallest complete example of an
agent that performs an irreversible action, and of where the confirmation for
one belongs.

## The problem

Searching for flights is cheap and repeatable. Booking one is neither.

![Two repeatable calls and one that is not. searchFlights and getOffer only read
and can be run again as often as you like. createOrder takes a payment, issues a
ticket against a passenger name, and brings the airline's change rules into
force, with no return path from any of it.](/img/flight-booker-irreversible.svg)

The agent needs that third call — a search agent that cannot book is not a
booking agent. What it also needs is for a person to see that particular call
before it happens, every time, with no way for the agent to arrange
otherwise.

## Why prompting is not the boundary

The obvious version of this is an instruction: *always ask the user before you
book*. That is a request, not a boundary. It sits in the same context as the
trip the user described, the offers that came back from the airline, and
whatever the model has concluded about being helpful. It can be forgotten under
a long conversation, argued out of, or overridden by text arriving from outside.

The version an experienced developer actually writes is better than that: put
the confirmation in the tool handler. The model calls `book_flight`, your
handler renders a dialog, waits, and books only on yes. That is correct, and it
is correct for a reason worth naming — in a tool loop, the set of operations the
model can perform is exactly the set you defined, and your handler sees every
one of them. **If booking is one tool call, stop reading. You do not need a
language for it.**

## Why this becomes a program

Booking is one call. Arriving at it is not. *Somewhere in Switzerland, first
week of October, cheapest* is three airports against five dates — fifteen
searches whose offers mean nothing except compared against each other. As a tool
loop, fifteen round trips and fifteen offer lists through the context window. As
a program, two loops and a comparison.

So Sky's model writes a program. That trade spends the property above: the
handler no longer sees every operation, because the operations happen inside a
program you did not write.

## Why a sandbox does not buy it back

The usual way to run a model-written program safely is Python in a container: an
injected `api.py` with the operations you meant to offer, a hardened process, an
egress allowlist. Put the booking confirmation in that `api.py`:

```python
import api
api._ask_approval = lambda *a: True       # the check is an attribute. Rebind it
api._session.post(DUFFEL_URL, json=...)   # or ignore the wrapper, the token is in here
```

No container setting stops either line. Python has no module confinement —
everything in the guest process is reachable from it — so a check in the guest's
own address space is a suggestion to code that can rewrite it.

Enforcement moves outward to the process, and there it cannot express the rule.
The process decides about *sockets*, the rule is about *bookings*. Deny the
socket and the agent cannot search. Allow it and `POST /air/orders` is one line
away from anywhere. An allowlist gets closer and still misses: searching and
booking are the same host, differing by a path and a body. Push the operations
out to a host over RPC and that does work — it is also tool calls rebuilt over a
socket, with the authority now in a config file that nothing checks against the
program until the program runs.

Harpe's answer is that the pause lives underneath the call, in a module the
program is not compiled against. Approval is requested by the trusted
implementation while the program is suspended inside it. The program can neither
observe nor skip it, because neither the approval nor the code performing it is
in its vocabulary.

![Sky in the browser. The user asks for a flight from New York City to Geneva,
and the agent answers with the cheapest economy offers, numbered, each showing
the airline, the airports and times, and the fare.](/img/flight-booker-search.png)

![A Confirm booking dialog over the chat, listing the route, duration, airline,
passenger name and total, with Reject and Approve
buttons.](/img/flight-booker-confirm.png)

![The reply after approval: booking confirmed, with the booking reference, order
id, total charged, and a note that this is a test
booking.](/img/flight-booker-booked.png)

## Three operations, one of them consequential

Everything the agent can do to an airline is declared in `sandbox/API.jo`:

```jo
interface Duffel
  def searchFlights(
    origin: String,
    destination: String,
    departureDate: String,
    passengerCount: Int,
    cabinClass: String
  ): SearchResult

  def getOffer(offerId: String): OfferDetail

  def createOrder(
    offerId: String,
    passengers: List[PassengerInfo],
    paymentAmount: String,
    paymentCurrency: String
  ): OrderConfirmation
end
```

Two of those are searches and can be repeated all day. The third takes money.
Nothing in the type of `createOrder` marks it as the dangerous one, and nothing
needs to — the difference is handled below the interface, in the implementation
the guest cannot see.

## Booking asks before it acts

The generated program calls `duffel.createOrder(...)` like any other operation.
It has no way to know that the call pauses, and no way to skip the pause, because
the request is made inside the trusted implementation in `sandbox/DuffelClient.jo`:

```jo
val decision = approvals.request("Confirm booking", summary)
if decision is !Approvals.Approved then
  return new api.OrderConfirmation("", "", "", "", "Booking " + Approvals.wire(decision))
```

`approvals` is a constructor argument of `DuffelClient`, supplied by the trusted
runtime — it is not something the guest can reach, name, or replace. The summary
is built from the offer and the passenger names the implementation already
validated, not from text the model supplied. The order is placed only after
`Approvals.Approved`.

That is a build fact, not a convention. `sandbox/jo.toml` compiles `guest`
against `api` alone and names `runtime` as `link = true`, so the implementation
is supplied at link time rather than offered as something `Task.jo` can import.
`DuffelClient`, `approvals` and the token are outside the guest's vocabulary,
which is why the two Python lines above have no spelling here — a program that
tries fails to build, and the error goes back to the model.

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

A program can still call `createOrder` in a loop, but every call prompts,
because the prompt belongs to the operation and not to the program. Loud is a
real defence with a limit, which is the next section.

This is the pattern described in [Human approval](/concepts/approvals/),
applied to a real irreversible operation. Compile-time capabilities decide that
the program *may* book a flight. The approval decides whether *this* booking
proceeds.

## Where approval stops working

An approval is only as good as what it shows. Two failure modes are worth naming
before you copy the pattern.

The first is that the summary is the security surface. If it were built from
text the model supplied, the model could describe a Tuesday flight and book a
Thursday one, and the click would be worthless. That is why
`bookingSummary(offer, passengers)` is assembled in the trusted implementation
from the values it already validated. Anything you render from model output is
decoration, not confirmation.

The second is that people stop reading. A prompt on every call trains the user
to click Approve, and an agent that asks about everything protects nothing. The
useful design is a small number of consequential operations behind approval and
everything else confined by the capability, which is why `searchFlights` and
`getOffer` do not ask. If your prompt count is climbing, the fix is usually a
narrower capability rather than another dialog.

## Run it

The template is a complete project. Copy it into your own directory:

```sh
jo new my-booker --template typescope/harpe:flight-booker
cd my-booker
pip install -r requirements.txt
cp .env.example .env
```

You need two credentials:

- A Duffel test API key from [app.duffel.com](https://app.duffel.com), under
  **Developers → API keys**. It starts with `duffel_test_`. Everything runs
  against Duffel's test mode: no real flights are booked and no money is
  charged.
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
