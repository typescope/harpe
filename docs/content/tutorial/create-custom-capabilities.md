+++
title = "Create a Custom Capability"
+++
A capability is a typed path from model-written code into trusted application
code. Its interface defines what generated programs may request. Its runtime
implementation decides how those requests reach the outside world.

This tutorial adds a read-only clock to the
[`hello` project](/tutorial/build-your-first-agent/). The finished example
compiles and runs without an external service or secret.

## Start from `hello`

```sh
jo new clock-agent --template typescope/harpe:hello
cd clock-agent
pip install -r requirements.txt
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`.

The initial sandbox grants only `stdout`. We will add `clock` in three places:
the public contract, the trusted runtime, and the build-time placeholder.

## 1. Define the contract

Replace `sandbox/SandboxAPI.jo` with:

```jo
namespace sandbox.api

import jo.IO.stdout

interface Clock
  def today(): String
end

param clock: Clock

defer def runTask(): Unit receives stdout, clock
```

This interface is the entire grant. Generated code may ask for today’s date,
but it cannot choose a timezone, read arbitrary system state, or mutate the
clock. Anything absent from this interface remains unreachable.

## 2. Supply the trusted implementation

Replace `sandbox/SandboxRuntime.jo` with:

```jo
namespace sandbox.runtime

import jo.IO.stdout
import sandbox.api.*

class SystemClock()
  def today(): String =
    py.module("datetime").date.today().isoformat().asString

  view Clock
end

def main(): Unit receives stdout =
  with clock = new SystemClock in
    runTask()
```

The implementation is trusted code, so it may use Python interoperability.
The generated guest never sees `py`, the `datetime` module, or any other host
authority—it receives only the `Clock` view.

Enable Python interoperability for the runtime module in
`sandbox/jo.toml`:

```toml
[module.runtime]
kind = "lib"
platform = "python"
enable-ffi = true
src = ["SandboxRuntime.jo"]
modules = ["api"]
```

Do not enable FFI on the `guest` module. That would give generated programs an
ambient path around your capability interfaces.

## 3. Update the placeholder

`sandbox/Task.jo` is compiled when the sandbox is prepared. Update its signature
to match the expanded contract:

```jo
namespace sandbox.guest

import jo.IO.stdout
import sandbox.api.*

def runTask(): Unit receives stdout, clock =
  println clock.today()
```

During a real tool call, `runCode` compiles the model’s program in a temporary
run directory. It does not modify this project file. The placeholder simply
proves that the API and runtime link correctly before the agent starts.

## 4. Build the boundary

```sh
jo build --spec sandbox/jo.toml guest
```

The build checks all three sides together:

- the guest implements the declared `runTask`.
- `SystemClock` provides the `Clock` interface.
- the runtime supplies `clock` when it calls `runTask`.

Now start the agent:

```sh
jo start
```

Ask:

```text
You ▸ What is today's date? Use the clock.
```

The model can write:

```jo
namespace sandbox.guest

import jo.IO.stdout
import sandbox.api.*

def runTask(): Unit receives stdout, clock =
  println clock.today()
```

A program that tries `py.module("datetime")`, reads a file, or calls an
undeclared method fails to compile in the guest.

## Designing real capabilities

The clock is intentionally small, but the same boundary applies to databases,
internal APIs, ticket systems, and payment providers:

- Put only the operations the agent needs in the interface.
- Prefer domain types over unconstrained strings.
- Keep credentials and provider SDKs in the runtime implementation.
- Derive user or tenant scope from trusted runtime context, not from an ID the
  generated program can forge.
- Separate read authority from write authority so they can be granted
  independently.

For example, prefer:

```jo
interface CustomerDirectory
  def findByEmail(email: CompanyEmail): Option[Customer]
end
```

over a generic SQL or shell capability. The narrow interface is useful
documentation, but more importantly it is a boundary the compiler enforces.

## Irreversible actions

A type can constrain an action, but it cannot decide whether a particular
charge, deletion, or message should happen now. Harpe supports
[human approval](/concepts/approvals/) during an active agent run. Put the
approval requirement inside the trusted capability implementation so generated
code can request the operation but cannot bypass or approve it.

## Checklist

- Does the interface expose only one coherent authority?
- Can a domain type replace a free-form `String` or `Int`?
- Is FFI enabled only for trusted runtime modules?
- Are credentials absent from guest-visible parameters and return values?
- Does the default placeholder still build?
- Does every irreversible effect require approval in trusted capability code?

Next: read [the compile-time sandbox](/concepts/sandbox/) in detail.
