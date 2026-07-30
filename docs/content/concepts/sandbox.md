+++
title = "Compile-time sandboxing"
weight = 2
+++
A Harpe agent acts by writing Jo programs. Every generated program must compile
against an API chosen by the agent developer before it can run.

## The capability gate

The generated program belongs to the `guest` module. That module has no Python
FFI and depends only on the pure `api` module:

![The untrusted guest uses the API contract. The trusted runtime implements the contract and links the guest entry point.](/img/project-deps.svg)

The API declares `runTask` and the capabilities it may receive:

```jo
interface Clock
  def today(): String
end

param clock: Clock

defer def runTask(): Unit receives stdout, clock
```

The model may write:

```jo
def runTask(): Unit receives stdout, clock =
  println clock.today()
```

It cannot use a file system, network client, shell, Python module, or undeclared
clock operation. Those names and implementations are absent from its dependency
graph. The compiler rejects the program before it runs.

## The trusted runtime

The `runtime` module implements the interfaces and supplies them when it calls
the guest:

```jo
class SystemClock()
  def today(): String = ...
  view Clock
end

with clock = new SystemClock in
  runTask()
```

The runtime may use FFI, credentials, and provider SDKs. Generated code sees
only the narrow `Clock` view. This is why adding a capability requires a
deliberate change on both sides of the boundary.

Harpe's built-in capability interfaces live in the pure `caps` module. It
contains interfaces and value types, but no FFI or implementations. An agent's
API can depend on `caps` without pulling the trusted Harpe runtime into the
guest.

## What the compiler guarantees

For a successfully compiled guest program:

- every capability call exists in the API
- every argument and result matches the declared types
- every required capability appears in `runTask`'s `receives`
- Python FFI and unlisted modules remain unavailable

The grant is structural. Prompt instructions cannot widen it, and prompt
injection cannot make an undeclared operation compile.

## What it does not guarantee

The compiler proves authority, not intent. A valid program can still:

- pass the wrong customer to an allowed operation
- make an expensive call that its interface permits
- loop or consume excessive resources
- exploit a compiler or trusted runtime bug

Design narrow capabilities first. Use domain types and separate read authority
from write authority. Put credentials and tenant scope in trusted runtime code.
The [custom capability tutorial](/tutorial/create-custom-capabilities/) shows
the complete pattern.

For protection below the compiler boundary, follow [Add defense in
depth](/tutorial/defense-in-depth/). It covers timeouts, environment scrubbing,
resource limits, filesystem isolation, and network restrictions.
