+++
title = "Create a Custom Capability"
weight = 5
+++
When the registry doesn't have what you need — an internal API, a private database, your
billing system — you write the capability yourself. For most agents this is **inline**: an
`interface` in the `api` module and an implementation in the `runtime` module. No separate
project, no `capabilities/` directory. Authoring one is the only time you write Jo to build
an agent.

This guide builds an **`email`** capability end to end. For where capabilities fit overall,
see [Concepts](/concepts/agent/).

## Step 1 — The interface (this *is* the grant)

Write the narrowest interface that does the job, in the `api` module. Every method here is
something the agent can do; anything you leave out, it cannot.

```jo
// sandbox/Email.jo (api module)
namespace EmailAPI

class Message(to: String, subject: String, body: String)
class Sent(id: String)

interface Email
  def send(msg: Message): Sent
end

param email: Email          // how a turn receives the capability
```

Then add it to the entry point so the model may receive it:

```jo
// sandbox/Entry.jo (api module)
defer def runTask(): Unit receives stdout, email
```

The runtime shows this interface to the model and the model receives `email` in `runTask`,
so it writes `email.send(...)` against these exact signatures — and the interface is the
only thing it can call.

**The craft is narrowing.** The boundary is the *type*, so push limits into it: if the
agent should only mail your own staff, make the recipient a `StaffId`, not a free `String`;
if attachments are off-limits, there's simply no parameter for them. A confused or
malicious turn cannot reach past what the interface allows.

## Step 2 — The implementation

Implement the interface in the `runtime` module — the trusted code. A class provides the
interface via `view`; secrets come from `.env`, never a build file.

```jo
// sandbox/EmailImpl.jo (runtime module)
namespace EmailRuntime

import EmailAPI.*

class EmailImpl(apiKey: String)
  def send(msg: Message): Sent =
    val id = Provider.post(apiKey, msg.to, msg.subject, msg.body)
    Sent(id)
  view Email                 // EmailImpl provides the Email interface
end

// the runtime injects this as the `email` param each turn
def provideEmail(): Email = EmailImpl(env("EMAIL_KEY"))
```

```sh
# .env
EMAIL_KEY=...
```

> The `provideEmail` factory, `view`, and `env(...)` show the *shape* of the wiring; the
> exact provider hooks are runtime-specific. The point that matters: the key lives in
> `.env`, and the implementation is the only place it's read. Because `runtime` is trusted
> code that the model never writes, this is also the only place that touches Python or a
> provider SDK.

If a capability must scope to *who* the turn is for — a user or tenant id — it reads that
**sandbox runtime context** the same way, from the per-turn environment the runtime sets,
never from an argument the guest passes (which the model could forge). See
[the compile-time sandbox](/concepts/agent/#the-compile-time-sandbox).

## Step 3 — Irreversible actions: ask first

If an action can't be undone — sending the email, charging a card, placing an order — a type
can't make it safe on its own. The capability asks a human, using the framework's `Confirm`
service. **`confirm` is a runtime-only service: it is injected into capability
implementations and is never part of `runTask`'s `receives`**, so the model's generated code
can neither call it nor skip it:

```jo
class EmailImpl(apiKey: String)
  def send(msg: Message): Sent receives confirm =
    if confirm.request(ActionSummary("Email \{msg.to} — \{msg.subject}")) is Rejected then
      Sent("cancelled")
    else
      Sent(Provider.post(apiKey, msg.to, msg.subject, msg.body))
  view Email
end
```

The framework renders that request on whatever channel is active — a terminal prompt, a
WhatsApp message, or the `OPERATOR` for an unattended agent — so the capability writes no
channel code, and a misled model can't skip it (the call lives in the vetted runtime, not
the guest program).

## Step 4 — Check it

The interface and implementation are in `api` and `runtime`; type-check the agent end to
end to confirm the capability resolves and the model can call it:

```sh
jo check --spec sandbox/jo.toml api       # the interface + entry point compile
jo build --spec sandbox/jo.toml guest     # the whole agent, including runtime, links
```

Then run the agent (`jo run`). A turn that calls `email.send(...)` compiles; a turn that
tries anything the interface doesn't declare fails to compile — the boundary you designed in
Step 1.

## Optional — make it reusable

The inline capability lives in one agent. To share it across agents, lift it into its own
**package** — the same interface/implementation split, as two standalone projects:

```
capabilities/
  email/
    api/      jo.toml + src/   # check library — the interface
    runtime/  jo.toml + src/   # link library — the implementation (depends on ../api)
```

The `api` project is a pure [check library](https://jo-lang.org/usage/concepts/packages); the `runtime`
project is a [link library](https://jo-lang.org/usage/concepts/packages) that depends on it. An agent then
*grants* the capability by depending on both — its interface in the `api` module, its
implementation in the `runtime` module:

```toml
# sandbox/jo.toml
[module.api]      # the runtime module also depends on email-runtime with link = true
modules = [{ id = "email", path = "../capabilities/email/api" }]   # a local path while developing
# once published, depend on the package instead:
#   packages = [{ name = "email", version = "1.0" }]
```

Publish it and the source dependency becomes a registry package — the reference moves from
`modules` to `packages`, nothing else:

```sh
jo package --spec capabilities/email/api/jo.toml
jo package --spec capabilities/email/runtime/jo.toml
```

See [Publishing](https://jo-lang.org/usage/guides/publishing). Start inline; promote to a package only when
a second agent needs the same capability.

## Design checklist

- **One capability, one coherent authority.** Don't bundle "read inventory" with "place
  orders" — split them so each can be granted on its own.
- **Narrow with types, not docs.** A `maxAmount`, a fixed recipient domain, a read-only
  interface — bounds the compiler enforces beat rules the model is asked to follow.
- **Reserve `confirm` for the irreversible.** Reversible actions run freely and are reviewed
  in the audit log; only the un-undoable ones should pause for a human.

## Next steps

- [Concepts](/concepts/agent/) — how a turn works and why the capability grant is the whole
  security boundary.
- [Monitoring agent](/tutorial/monitoring-agent/) — writes two inline capabilities (`inventory`,
  `reorder`) in a working agent.
