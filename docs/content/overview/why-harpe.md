+++
title = "Why Harpe?"
+++
Harpe is a framework for building **specialized agents** with boundaries
enforced by [compile-time sandboxing](/overview/compile-time-sandboxing/). It is
not a coding agent for developing a software repository.

It targets agentic workflows involving critical infrastructure, sensitive
data, or consequential operations. In these settings, broad access is the wrong
security model. These agents need useful autonomy under **fine-grained
permissions**.

![Model-generated code is confined behind a typed boundary. It can reach the trusted runtime and outside world only through capabilities explicitly exposed by the application's API.](/img/typed-sandbox.svg)

## The design choice

Harpe has the model write a small Jo program for each turn. That program is
compiled as an untrusted guest against an application-defined API. Trusted code
implements the API and retains credentials, tenant scope, and validation.

This moves the authority boundary into versioned source:

- capabilities can represent domain operations, not just files and network
  access
- capabilities support authority attenuation before access reaches the
  guest—for example, narrowing a database connection to a read-only,
  tenant-scoped query interface
- direct and transitive capability use is checked by the compiler
- undeclared operations, FFI, and ambient host access are unavailable to the
  guest

## Why let the agent write code?

Code is a compact action language. It gives agents loops, branching, error
handling, and data transformations without routing every intermediate value
through the model.

This is not unique to Harpe. CodeAct
[[1]](#reference-codeact) reported better task success than common text and
JSON action formats in its benchmarks. Anthropic
[[2]](#reference-anthropic) and Cloudflare
[[3]](#reference-cloudflare) have shown how code execution can reduce
tool-schema overhead, compose operations, and process intermediate data outside
the model context.

Harpe addresses the security consequence of that direction: if code is the
action interface, its authority should be explicit and mechanically checked.

## The tradeoff

The compiler proves which capabilities a generated program can use. It does not
prove that an allowed action is correct, cheap, or desirable. Consequential
operations may still need approval. Runtime isolation remains useful for
resource limits and defense in depth.

Harpe also requires you to design typed capabilities and implement their
trusted side. That cost is justified when the boundary is part of the product,
not an incidental deployment detail.

Use Harpe when an agent has a defined role, known integrations, and authority
that should be narrow and reviewable. If the task requires broad, changing
access to a development environment, use a code agent instead.

Next: see why [compile-time sandboxing](/overview/compile-time-sandboxing/)
makes those boundaries durable.

## References

1. <span id="reference-codeact"></span>[Executable Code Actions Elicit Better
   LLM Agents](https://arxiv.org/abs/2402.01030)
2. <span id="reference-anthropic"></span>[Code execution with MCP: Building
   more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp)
3. <span id="reference-cloudflare"></span>[Code Mode: give agents an entire API
   in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
