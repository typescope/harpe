+++
title = "Build a Conversational Agent"
weight = 2
+++
We'll build a **flight-booking assistant**: you tell it your trip and constraints, it
searches across airlines for the best options, and it books one — confirming with you
before it charges your card. We'll run it in the terminal first, then put it on WhatsApp
without changing a line of logic.

```
you ── "SFO→JFK July 10, nonstop, under $600" ──▶ agent
                                                   │ searches airlines,
                                                   │ ranks options
   "Best 3 options…  book one?" ◀──────────────────┘ replies
        │ "book the United one"
        ▼
   "That's $548 on your Visa ••1234 — confirm?" ◀── the charge waits for your yes
```

> New to Harpe? Build the [hello-world agent](/tutorial/) first, and keep
> [Concepts](/tutorial/concepts/) handy for the why.

## The whole thing

An agent's capabilities are summed up by its **entry-point contract** in the `api` module — the
`receives` list is everything the agent may do:

```jo
// sandbox/Entry.jo (api module) — the flight booker's capabilities
defer def runTask(): Unit receives stdout, flights, payment
```

`flights` (read-only search) and `payment` (capped, asks to confirm) are published
capabilities, wired into the `api` module (their interfaces) and the `runtime` module (their
implementations); the agent replies by writing to `stdout`, which the runtime relays to the
user. The top-level `jo.toml` pulls in the Harpe loop and points `main` at it (`Harpe.cli`) —
that's the trigger — so `jo run` launches the agent with no source files; `.env` holds the
model and keys. All written by the template.

```sh
jo new flight-bot --template conversational
cd flight-bot
claude          # "build a flight booker: search airlines, book with confirmation"
jo run
```

That's a working agent: `jo new` scaffolds it, Claude fills in the capabilities, `AGENT.md`,
and skills using the bundled `build-agent` skill, and `jo run` chats with it. The rest of
this guide explains each piece — and how to do it by hand.

## Step 1 — Scaffold

```sh
jo new flight-bot --template conversational
cd flight-bot
```

You get the usual agent shape:

```
flight-bot/
  jo.toml          # the agent app: depends on the Harpe loop; `jo run` launches it
  sandbox/
    jo.toml        # one project, three modules — api, runtime, guest
    Entry.jo       # api module: the contract + capability interfaces
    Runtime.jo     # runtime module: the implementations
    Task.jo        # guest module: the model's code each turn (don't edit)
  AGENT.md
  skills/
  .env.example     # copy to .env: model, API key, capability secrets
  data/            # persistent state across runs: sessions, chat history, world-state
  logs/            # the audit log lands here when you run
  CLAUDE.md        # onboards Claude Code to finish the agent
  .claude/skills/  # the bundled "build-agent" skill
```

The quickest way to fill it in is to open Claude Code (`claude`) and describe the agent;
it knows these conventions from the bundled skill. The steps below are exactly what it
does — and what you'd type by hand.

## Step 2 — The trigger

A conversational agent takes a turn whenever **a person sends a message**. The trigger is
which Harpe loop `main` points at, set in `jo.toml` — no code. For development, `Harpe.cli`
gives you a chat right in your terminal:

```toml
# jo.toml
[module.app]
links = [
  { from = "jo.main", to = "Harpe.cli" },
]
```

We'll switch this to `Harpe.whatsapp` in Step 7. Nothing else will change.

## Step 3 — Grant capabilities

Granting capabilities *is* the security decision (see the
[compile-time sandbox](/tutorial/concepts/#the-compile-time-sandbox)) — each one in the entry point's `receives`
list is something the agent may use; anything not listed, it *cannot*. This agent needs
three:

- **`stdout`** — built in; the agent's output. It just writes text (`println`), and the
  runtime relays it to whoever's listening — your terminal now, WhatsApp later.
- **`flights`** — search airlines for fares matching constraints. **Read-only** — its
  interface has no method that books or charges, so it's safe to grant outright.
- **`payment`** — charge a card to book. This one *spends money*, so its implementation is
  capped (Step 5); the capability itself asks before each charge.

Both `flights` and `payment` are published capabilities. Granting one is depending on its
interface in the `api` module and its implementation in the `runtime` module, then listing it
in the entry point:

```toml
# sandbox/jo.toml

[module.api]        # the interfaces the model compiles against
packages = [
  { name = "flights", version = "1.0" },
  { name = "payment", version = "1.0" },
]

[module.runtime]    # the implementations the runtime wires in
packages = [
  { name = "flights-runtime", version = "1.0", link = true },
  { name = "payment-runtime", version = "1.0", link = true, maxAmount = "2000 USD" },
]
```

```jo
// sandbox/Entry.jo (api module)
defer def runTask(): Unit receives stdout, flights, payment
```

Credentials go in `.env` (the runtime reads it; never commit it):

```sh
# .env
PAYMENT_KEY=...                    # your payment provider key
```

To see what a capability lets the agent do, read its interface with `jo doc --spec
sandbox/jo.toml api`. `stdout` isn't listed in the api module's `packages` — the runtime
supplies it and relays whatever the agent prints back to the user. Built in.

## Step 4 — Teach it

**`AGENT.md`** is the agent's persona and standing rules — its system prompt:

```markdown
# Flight Booking Assistant

You help the user find and book flights.

- Gather the trip: origin, destination, dates, and any constraints
  (max stops, price ceiling, preferred airlines, times).
- Search, then present the best 2–3 options with price, stops, and times.
- Before booking, state the exact price and which card.
- Never book more than the user asked for.
```

**`skills/`** holds knowledge the agent looks up on demand:

```markdown
<!-- skills/preferences.md -->
# Traveler Preferences

- Prefer nonstop; tolerate 1 stop if it saves more than $150.
- Aisle seat. No red-eyes unless asked.
- Loyalty: United MileagePlus, Delta SkyMiles.
```

The agent retrieves the right skill when it needs it, so knowledge grows without growing
the prompt.

## Step 5 — Make spending safe

`flights` is read-only, so granting it is already safe — searching can't harm anyone.
`payment` is different: **charging a card is irreversible**, the one kind of action a type
alone can't fully make safe. Two things handle it — and **neither is confirmation config
you write**:

- **A typed ceiling**, set on the implementation in the `runtime` module. Even a confused or
  maliciously-prompted model physically cannot charge more than this:

  ```toml
  # sandbox/jo.toml
  [module.runtime]
  packages = [
    { name = "payment-runtime", version = "1.0", link = true, maxAmount = "2000 USD" },
  ]
  ```

- **Confirmation, built into the capability.** The `payment` capability asks before every
  charge — that's *its* behavior, not something you configure. Because the framework
  provides confirmation as a channel-aware service, it surfaces the request wherever the
  agent is talking: a prompt in your terminal now, a WhatsApp message once you deploy. The
  person in the conversation approves.

You grant the capability and set its bound; *when* to confirm is the capability's business.

## Step 6 — Run and test

```sh
jo run
```

```
flight-bot ▸ chat (type /quit to exit)

you ▸ I need SFO→JFK on July 10, back the 14th, nonstop if you can, under $600.
bot ▸ Here are the best options:
        1. United  9:00a → 5:25p  nonstop  $548
        2. JetBlue 7:15a → 3:40p  nonstop  $572
        3. Delta  11:30a → 10:10p 1 stop   $495
      Want me to book one?
you ▸ book the United one
```

To book, the agent calls **`payment`**, which asks before charging. The framework surfaces
that request for your approval right in the chat — and shows you the exact, typed program
that will run:

```
This turn will charge your card — confirm before it runs:

      payment.charge(amount = 548_00, card = "••1234", ref = "UA482 SFO-JFK")

bot ▸ That's $548 on your Visa ••1234 — confirm? (yes/no)
you ▸ yes
bot ▸ Booked! ✈️  Confirmation UA831Q — United, July 10, 9:00a. Have a great trip!
```

You can see it charges exactly $548, nothing more — and you know its *type* couldn't
exceed $2,000 even if the program tried. Search ran with no interruption; the charge
waited for you.

Behind the scenes the whole interaction is Jo programs — the agent's *only* tool:

```jo
// the search (read-only — runs immediately):
def runTask(): Unit receives stdout, flights, skills =
  val opts = flights.search(from = "SFO", to = "JFK", date = "2026-07-10",
                            maxStops = 1, maxPrice = 600_00)
  println(present(opts.sortBy(o => o.price).take(3)))

// the booking (calls payment → confirms with the user):
def runTask(): Unit receives stdout, flights, payment =
  val fare = flights.hold("UA482")
  payment.charge(fare.price, card, fare.ref)        // ← confirmed before it runs
  println("Booked! ✈️ Confirmation " + fare.confirmation)
```

## Step 7 — Go live on WhatsApp

Point the trigger at the WhatsApp loop and add your credentials:

```toml
# jo.toml
[module.app]
links = [
  { from = "jo.main", to = "Harpe.whatsapp" },
]
```

```sh
# .env
WHATSAPP_NUMBER=+1555...               # your WhatsApp Business number
WHATSAPP_TOKEN=...                     # from Meta's dashboard
```

Then run the same project on your host (`jo run`, kept alive by your process manager).

**Receiving messages.** `Harpe.whatsapp` is a *connector*: it turns each inbound message into
a turn and sends each reply — the turn's `stdout` — back over its connection to WhatsApp. How
that connection works is the connector's business: Meta's official Cloud API is a webhook in /
send-API out (authenticated by `WHATSAPP_TOKEN`); a client-library connector is instead a
persistent, QR-paired session. Either way the contract is the same — *a message in starts a
turn, the turn's output goes back* — so everything above the connector is unchanged.

Moving from the terminal to WhatsApp also changes how a conversation is **bounded** — the two
flavors a conversational agent comes in:

| Flavor | Keyed on | Bounded by |
|---|---|---|
| **Session-based** — CLI, web chat | an explicit **session** the user starts, ends, and resumes | the user |
| **Identity-based** — WhatsApp, Slack, Telegram | a durable **identity** (the peer) | runtime policy: a continuous thread, an idle timeout, or `/new` |

The CLI build was session-based; on WhatsApp it becomes identity-based — which changes how a
conversation is bounded, but nothing in your `runTask`.

**Sessions.** Each traveler is one session, keyed by their number. The runtime persists each
one under `data/` — the conversation history and any world-state — and loads it as the turn's
context (the *gather context* step of [a turn](/tutorial/concepts/#how-a-turn-works)) before running
`runTask`, saving it after. That persistence is what makes a conversation resumable: someone can reply
hours later, or after a restart, and the agent picks up where it left off. Your `runTask`
stays **stateless** — the runtime owns the session, not the model.

**When does a session end?** On the CLI it's obvious — the process starts and quits. A
WhatsApp (or Slack, or Telegram) thread is *persistent*: the number is a durable **identity**,
but the transport never signals "this conversation is over." So a session boundary isn't an
event you receive — it's a policy the runtime applies. By default the thread is **continuous**:
each turn sees a bounded rolling window of recent messages (plus a running summary of older
ones), so context stays finite without ever resetting the relationship. Want episodes instead?
Configure an **idle timeout** (silence past a cutoff starts a fresh context, long-term memory
kept) or honor an explicit **`/new`**. Either way it's runtime configuration — `runTask` only
ever sees the context it's handed.

The confirmation works identically: the "$548 — confirm?" arrives as a WhatsApp message. The
*logic you wrote is unchanged*; only the trigger moved from your terminal to WhatsApp.

## How it works

The agent has exactly **one tool: write a Jo program**. Every reply, every search, every
charge is a typed program `jo` compiles and runs. Its authority is the capability set you
granted — `flights` can only read, `payment` can only charge up to $2,000 and only after
you confirm — and that bound is proven by the compiler, not by trusting the model. Even a
maliciously crafted message can't make the agent exceed it. Everything it does lands in
the audit log under `logs/`. See [how a turn works](/tutorial/concepts/#how-a-turn-works) for the full picture.

## Next steps

- [Request-driven agent](/tutorial/request-driven-agent/) — same project, triggered by an HTTP request.
- [Monitoring agent](/tutorial/monitoring-agent/) — same project, applied to a scheduled monitor.
- [Create a custom capability](/tutorial/create-custom-capabilities/) — when the registry doesn't have what you need.
- [Concepts](/tutorial/concepts/) — the model underneath all three.
