+++
title = "Why Harpe?"
+++
Harpe is a framework for building **specialized agents**. It enforces
fine-grained permissions through
[compile-time sandboxing](/overview/compile-time-sandboxing/). It is not a code
agent for developing a software project.

It is designed for agentic workflows involving critical infrastructure,
sensitive data, or consequential operations. For security, agents are granted fine-grained permissions that are explicit and reviewable.

![Model-generated code is confined behind a typed boundary. It can reach the trusted runtime and outside world only through capabilities explicitly exposed by the application's API.](/img/typed-sandbox.svg)

## A typed authority boundary

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

Harpe takes a specific position on the security consequence: LLM generated code is
useful and effective, but ambient authority is the wrong model for it. Its granted authority should be
explicit, narrow, and mechanically checked.

## When Harpe fits

Use Harpe when an agent has a defined role, known integrations, and authority
that should be narrow and reviewable. If the task requires broad, changing
access to a development environment, use a code agent instead.

The choice has a cost. You must design capability interfaces and provide
trustworthy implementations. The work is justified when provable and high-risk aversion authority control is uncompromisable for the product.

The compiler verifies which capabilities generated code can use. It does not
prove that an allowed action is correct, cheap, or desirable. Consequential
operations may still need approval.

Next: see why [compile-time sandboxing](/overview/compile-time-sandboxing/)
makes those boundaries durable.

## References

1. <span id="reference-codeact"></span>[Executable Code Actions Elicit Better
   LLM Agents](https://arxiv.org/abs/2402.01030)
2. <span id="reference-anthropic"></span>[Code execution with MCP: Building
   more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp)
3. <span id="reference-cloudflare"></span>[Code Mode: give agents an entire API
   in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
