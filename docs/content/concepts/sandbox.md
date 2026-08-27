+++
title = "Code Mode and Sandboxing"
+++
Harpe provides a `runCode` tool that you can add to an agent. It lets the model
write and run a small Jo program for a task. The compile-time sandbox applies to
these generated programs. It does not apply to ordinary model replies or change
how other tools run.

Treat generated code as untrusted. Before Harpe runs it, the code must compile
against a set of capabilities chosen by the application developer. If the code
tries to use authority it was not given, compilation fails.

![The compiled guest is sealed behind a type-checked boundary. Its only paths to the trusted runtime and outside world are the typed capabilities explicitly granted to it.](/img/typed-sandbox.svg)

## The capability boundary

A capability is a typed interface for something generated code is allowed to
do. It might read a customer record, search a catalog, or get the current time.
The interface exposes the permitted operations without exposing credentials,
SDK clients, or application internals.

The generated program runs as a **guest**. Your application and the capability
implementations form the **trusted runtime**. The guest can use only the
capability interfaces and pure libraries included in its build. It cannot see
the implementations or the rest of the application.

![The untrusted guest uses the API contract. The trusted runtime implements the contract and links the guest entry point.](/img/project-deps.svg)

This separation uses Jo's
[two-world architecture](https://jo-lang.org/security/two-worlds.html). Untrusted
code is checked in the confined world, then linked with implementations from the
trusted world.

The API declares the guest entry point and the capabilities available to it:

```jo
interface Clock
  def now: String
end

param clock: Clock

defer def runTask(): Unit receives stdout, clock
```

Generated code can use the grant:

```jo
def runTask(): Unit receives stdout, clock =
  println clock.now
```

It cannot access a file system, network client, shell, Python module, or an
undeclared clock operation. Those APIs are not available when the guest is
compiled.

## Trusted implementations

Your application provides the trusted implementation of each capability and
binds it before entering generated code:

```jo
class SystemClock
  def now: String = ...
  view Clock
end

with clock = new SystemClock in
  runTask()
```

The implementation may use credentials, provider SDKs, and application state.
It is responsible for validation and for limiting operations to the current
user or tenant. Generated code receives only the narrow capability interface.

Harpe's built-in capability interfaces and value types live in the pure
`harpe-caps` module. Their trusted implementations live outside the guest
dependency graph. An application can replace an implementation without changing
the interface exposed to generated code.

Use narrow domain capabilities and derive user or tenant scope in trusted code.
Separate read and write authority when they should be granted independently.
The [custom capability tutorial](/tutorial/create-custom-capabilities/) shows
the complete pattern.

## What happens when a program runs

When the model calls `runCode`, Harpe:

1. Places the generated source in a fresh run directory.
2. Compiles it with only the granted capability interfaces and dependencies.
3. Stops and reports a compiler error if the code asks for anything outside
   that boundary.
4. Runs the program with the trusted capability implementations if compilation
   succeeds.

Each program gets its own source, output, and compiler artifacts. Shared
dependencies remain read-only. Concurrent runs therefore do not change one
another's build state.

## What the compiler guarantees

For a program that compiles:

- every capability call exists in the exposed API
- arguments and results match the declared types
- capability requirements propagate through nested calls
- every required capability is declared by the guest entry point
- FFI and modules outside the guest dependency graph remain unavailable

These guarantees come from the program's build boundary, not from the prompt.
Prompt instructions and prompt injection cannot make an undeclared operation
compile.

## What it does not guarantee

The compiler proves which operations a program may use. It does not prove that
the program chose the right operation or argument. Consequential capabilities
may require [human approval](/concepts/approvals/) in their trusted
implementations.

An external sandbox can limit CPU and memory and apply system-level file system
and network policies. These controls provide defense in depth around the
compile-time boundary. See [Add Defense in Depth](/guides/defense-in-depth/).
