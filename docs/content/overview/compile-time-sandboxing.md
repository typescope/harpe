+++
title = "Compile-time Sandboxing"
+++
Harpe checks an agent's authority **before generated code runs**. Every side
effect is denied by default; the model can use only the typed capabilities
provided by the application.

![Compile-time sandboxing is API gating in the language. Ambient paths such as globals, network, files, reflection, type casts, and control effects are rejected; typed capabilities are the confined function's only doors to the outside world.](/img/compile-time-sandboxing.svg)

Capabilities are the only doors to the outside world.

## Why compile time?

Runtime sandboxes—containers, virtual machines, syscall filters, filesystem
permissions—speak in machine resources. They can block a file or host, but not
naturally express “only this customer's rows,” “calendar reads but no writes,”
or “draft a refund but require approval.”

Those are application rules. Harpe expresses them as typed interfaces.

| Runtime sandboxing | Compile-time sandboxing |
|---|---|
| Speaks in processes, files, sockets, and system calls | Speaks in typed application operations |
| Authority is spread across deployment configuration | Authority is visible in versioned interfaces |
| A violation is detected while code runs | A violation is a source-level compiler error |

## What the agent receives

The sandbox API can expose a narrow domain capability:

```jo
interface Calendar
  def available(day: Date): List[TimeSlot]
  def reserve(slot: TimeSlot, attendee: Email): Booking
end

defer def runTask(): Unit receives stdout, calendar
```

Generated code can print and call this `Calendar`. It cannot acquire a shell,
inspect arbitrary files, import Python, or use a raw network client: those names
are absent from its compilation environment.

The trusted application implements `Calendar` and keeps credentials, tenant
scope, retries, and validation behind the interface. Capability requirements
are tracked through nested calls, so generated code cannot hide authority in a
helper.

The result is:

- **least authority:** grant only the operations this agent needs
- **fine-grained confinement:** scope access to one tenant, directory, or API
- **auditable boundaries:** review typed interfaces in version control
- **failure before side effects:** invalid authority becomes a compiler error
- **safe composition:** use normal programming constructs without granting a
  general-purpose shell

## Compile-time and runtime defenses

The compiler proves authority, not intent. A permitted program can still choose
the wrong calendar slot or make an expensive allowed request. Use narrow
interfaces and human approval for consequential operations.

Runtime sandboxes remain useful for resource limits and for defense in depth.
However, they are not a substitute for application-level boundaries.

For the mechanics and guarantees, read the detailed
[Sandbox concept](/concepts/sandbox/). To build one, follow
[Create a Custom Capability](/tutorial/create-custom-capabilities/). The
[Jo capabilities overview](https://jo-lang.org/overview/capabilities.html)
explains the language model underneath Harpe.
