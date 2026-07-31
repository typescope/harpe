+++
title = "Sandbox Architecture"
+++
Harpe treats LLM-generated programs as untrusted code. Before a program can
run, it must compile against capability interfaces chosen by the agent
developer. Authority that is not granted is a compilation error.

![The compiled guest is sealed behind a type-checked boundary. Its only paths to the trusted runtime and outside world are the typed capabilities explicitly granted to it.](/img/typed-sandbox.svg)

## The capability boundary

Generated code belongs to a guest module. Its dependency graph contains the
application's capability API and any explicitly included pure libraries. It
does not contain Python FFI, capability implementations, or the rest of the
host application.

![The untrusted guest uses the API contract. The trusted runtime implements the contract and links the guest entry point.](/img/project-deps.svg)

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
undeclared clock operation. Those paths are absent from its compilation
environment.

## Trusted implementations

A trusted runtime implements capability interfaces and binds them before
entering generated code:

```jo
class SystemClock()
  def now: String = ...
  view Clock
end

with clock = new SystemClock in
  runTask()
```

Trusted implementations may use FFI, credentials, provider SDKs, and
application state. They are responsible for validation and tenant scope.
Generated code receives only the narrow capability interface.

Harpe's built-in capability interfaces and value types live in the pure
`harpe-caps` module. Their trusted implementations live outside the guest
dependency graph. An application can replace an implementation without changing
the interface exposed to generated code.

Use narrow domain capabilities and derive user or tenant scope in trusted code.
Separate read and write authority when they should be granted independently.
The [custom capability tutorial](/tutorial/create-custom-capabilities/) shows
the complete pattern.

## Per program

When the model calls `runCode`, Harpe:

1. writes the generated source into a fresh run directory
2. compiles it against the prebuilt capability API and dependencies
3. executes it only if compilation succeeds
4. starts the trusted runtime, which supplies the granted capabilities

Each program gets its own source, output, and compiler artifacts. Shared
dependencies remain read-only, so concurrent runs do not mutate one another's
build state.

## What the compiler guarantees

For a program that compiles:

- every capability call exists in the exposed API
- arguments and results match the declared types
- capability requirements propagate through nested calls
- every required capability is declared by the guest entry point
- FFI and modules outside the guest dependency graph remain unavailable

The grant is structural. Prompt instructions cannot widen it. Prompt injection
cannot make an undeclared operation compile.

## What it does not guarantee

The compiler proves authority, not intent. A permitted program can still choose
the wrong argument or misuse an allowed operation. Consequential capabilities
may require [human approval](/concepts/approvals/) in their trusted
implementations.

An external sandbox can limit CPU and memory and apply system-level file system
and network policies. These controls provide defense in depth around the
compile-time boundary. See [Add Defense in Depth](/guides/defense-in-depth/).
