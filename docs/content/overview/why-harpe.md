+++
title = "Why Harpe?"
+++
Harpe is a framework for building **specialized agents**.

It is designed for agentic workflows that rely on code generation to act on
critical infrastructure and sensitive data, or to perform consequential
operations.

## Why specialized agents?

A general-purpose agent asks to be trusted with broad authority. That is not an
option where an action moves money, changes an official record, or touches a
patient's file — finance, banking, government, health care.

A specialized agent has one defined role, so its authority can be cut down to
that role and checked. That is the **principle of least authority** (PoLA), and
we believe it is the only way to make an agent fit for high-stake critical
infrastructure and sensitive data.

## A typed authority boundary

Harpe enforces fine-grained permissions through
[compile-time sandboxing](/overview/compile-time-sandboxing/).

![Model-generated code is confined behind a typed boundary. It can reach the trusted runtime and outside world only through capabilities explicitly exposed by the application's API.](/img/typed-sandbox.svg)

For each agent action step, the model writes a Jo program. Harpe compiles it as an
untrusted guest against capability interfaces chosen by the application.
Trusted implementations retain credentials, tenant scope, and validation.

The capability interface scopes the guest's authority:

- broad authority can be attenuated into narrow domain operations, such as a
  read-only, tenant-scoped query
- undeclared capabilities, FFI, and ambient host access are unavailable
- the compiler checks direct and transitive capability usage

## Why let the agent write code?

Code is a compact action language. It provides loops, branching, error handling,
and data transformation without routing every intermediate value through the
model.

This is not unique to Harpe. CodeAct
[[1]](#reference-codeact) reported that code achieves better task success than
common text and JSON action formats in its benchmarks. Anthropic
[[2]](#reference-anthropic) and Cloudflare
[[3]](#reference-cloudflare) have shown how code execution can reduce
tool-schema overhead, compose operations, and process intermediate data outside
the model context.

Harpe takes a specific position on the security consequence: LLM-generated code is
useful, but they should be confined to only permitted operations.
Following PoLA, we think that granted authority should be explicit, narrow, and
mechanically checked.

## The cost of specialized agents

To develop a secure specialized agent, the trust boundary has to be defined
explicitly. You design the capability interfaces the agent acts through, and
provide trustworthy implementations behind them. The compiler verifies which
capabilities generated code can use.

Next: see why [compile-time sandboxing](/overview/compile-time-sandboxing/)
makes those boundaries durable.

## References

1. <span id="reference-codeact"></span>[Executable Code Actions Elicit Better
   LLM Agents](https://arxiv.org/abs/2402.01030)
2. <span id="reference-anthropic"></span>[Code execution with MCP: Building
   more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp)
3. <span id="reference-cloudflare"></span>[Code Mode: give agents an entire API
   in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
