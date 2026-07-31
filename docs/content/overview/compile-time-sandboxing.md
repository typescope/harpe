+++
title = "Compile-time Sandboxing"
+++
Harpe checks an agent's authority **before generated code can run**. Every side
effect is denied by default. Each program written by the model is compiled
against a small API chosen by the agent developer; if it asks for a capability
outside that API, it does not compile.

![Compile-time sandboxing is API gating in the language. Ambient paths such as globals, network, files, reflection, type casts, and control effects are rejected; typed capabilities are the confined function's only doors to the outside world.](/img/compile-time-sandboxing.svg)

Capabilities are the only doors to the outside world.

This turns an agent's boundary into something the toolchain can enforce:

```jo
defer def runTask(): Unit receives stdout, calendar
```

This agent may print and use the application's `calendar` capability. It cannot
silently acquire a shell, inspect arbitrary files, import Python, or call an
undeclared network client, because those operations are absent from its
compilation environment.

## Sandboxing at the application level

Runtime sandboxes—containers, virtual machines, syscall filters, filesystem
permissions—confine a process from the outside. They are important, but they
operate on machine resources. A container can deny access to `/etc/passwd` or
block an outbound host. It cannot naturally express rules such as:

- query only the rows belonging to this customer
- read calendar availability but never create an event
- draft a refund but require a person to approve it
- send a message only to the user who started this session

Those are application boundaries. Harpe represents them as typed interfaces
implemented by trusted application code. The generated program receives a
customer-scoped database view, a read-only calendar, or a draft-only refund
service—not the raw database, credential, or network connection behind it.

This gives the application authority confinement at whatever granularity its
domain requires.

| Runtime sandboxing | Compile-time sandboxing |
|---|---|
| Speaks in processes, files, sockets, and system calls | Speaks in typed application operations |
| Authority is spread across deployment configuration | Authority is visible in versioned interfaces |
| A violation is detected while code runs | A violation is a source-level compiler error |

Traditional languages also expose ambient authority: globals, filesystem and
network APIs, reflection, FFI, and process control are often reachable without
an explicit grant. Confining one function then requires accounting for every
indirect escape route. The Jo guest environment used by Harpe removes those
routes. Resource access must arrive through an explicit capability, and the
compiler tracks that requirement through the call graph.

## Boundaries that survive bad instructions

Prompt instructions describe what an agent should do. They are valuable, but
they are still text interpreted by a model. Prompt injection, ambiguous
requests, or model mistakes can steer behavior away from those instructions.

A compile-time boundary answers a different question: **what can this program
possibly do?** Model-written code cannot widen the API it compiles against.
Changing that authority requires a deliberate application change.

This provides several practical benefits:

- **Least authority by construction.** Each specialized agent receives only the
  operations needed for its role.
- **Fine-grained confinement.** Authority can mean one directory, one API
  operation, or one tenant's records—not merely access to an entire machine
  resource.
- **Reviewable access.** Interfaces and `receives` declarations show authority
  in ordinary source code instead of scattering it across deployment
  configuration.
- **Failures before side effects.** Missing capabilities and invalid calls are
  rejected before execution begins.
- **Typed operations.** Capability arguments and results must match the domain
  types selected by the application.
- **Safer composition.** The agent can use loops, branches, and intermediate
  values without being given a general-purpose shell.
- **Deployment-specific boundaries.** Two applications can use the same model
  while exposing entirely different capabilities.

## Narrow interfaces improve the agent

A capability is not merely a security wrapper. It gives the model a vocabulary
for the domain. An interface such as:

```jo
interface Calendar
  def available(day: Date): List[TimeSlot]
  def reserve(slot: TimeSlot, attendee: Email): Booking
end
```

is easier to understand and harder to misuse than raw HTTP access plus a
credential. Validation, tenant scope, retries, and secrets stay in trusted
application code. The generated program sees the smaller operation it actually
needs.

The compiler also tracks capability requirements through calls. Generated code
cannot hide an operation inside a helper and make its authority disappear: the
required capability still has to reach the program's entry point and be
granted there.

## Compile-time and runtime defenses

The compiler proves which capabilities a program uses; it does not prove that
every permitted action is wise. A valid program can still choose the wrong
calendar slot or make an expensive allowed request. Use narrow domain
interfaces, human approval for consequential operations, and process isolation
for resource and implementation risks.

The two layers answer different questions:

- **Compile-time sandboxing:** which application operations can this generated
  program invoke?
- **Runtime sandboxing:** what can the resulting process do if the compiler,
  runtime, or trusted implementation has a vulnerability?

Harpe uses the compiler as the authority boundary and supports OS isolation as
defense in depth. Neither layer needs to impersonate the other.

For the mechanics and guarantees, read the detailed
[Sandbox concept](/concepts/sandbox/). To build one, follow
[Create a Custom Capability](/tutorial/create-custom-capabilities/). The
[Jo capabilities overview](https://jo-lang.org/overview/capabilities.html)
explains the language model underneath Harpe.
