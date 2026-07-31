+++
title = "Create a Custom Capability"
+++
A capability interface defines what LLM-generated programs may request. Its
trusted implementation decides how those requests reach the outside world.

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
  def now: String
end

param clock: Clock

defer def runTask(): Unit receives stdout, clock
```

This interface is the entire grant. Generated code may ask for the current time,
but it cannot choose a timezone, read arbitrary system state, or mutate the
clock. Anything absent from this interface remains unreachable.

## 2. Supply the trusted implementation

Replace `sandbox/SandboxRuntime.jo` with:

```jo
namespace sandbox.runtime

import jo.IO.stdout
import sandbox.api.*

class SystemClock()
  def now: String =
    py.module("datetime").datetime.now().isoformat().asString

  view Clock
end

def main(): Unit receives stdout =
  with clock = new SystemClock in
    runTask()
```

The implementation is trusted code, so it may use Python interoperability APIs.
The generated guest never sees `py`, the `datetime` module, or any other host
authority—it receives only the `clock` capability.

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
  println clock.now
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
You ▸ What time is it?
```

The model can write code like the following to get the current time:

```jo
namespace sandbox.guest

import jo.IO.stdout
import sandbox.api.*

def runTask(): Unit receives stdout, clock =
  println clock.now
```

A program that tries `py.module("datetime")`, reads a file, or calls an
undeclared method fails to compile.

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

Next: read [the compile-time sandbox](/concepts/sandbox/) in detail.
