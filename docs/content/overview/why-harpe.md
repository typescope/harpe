+++
title = "Why Harpe?"
+++
Harpe is a framework for building **specialized agents** with boundaries
enforced by [compile-time sandboxing](/overview/compile-time-sandboxing/). It is
not a coding agent for developing a software repository.

Harpe is designed for agentic workflows involving critical infrastructure,
sensitive data, or consequential operations—where broad access is unacceptable
and fine-grained permissions matter.

![Model-generated code is confined behind a typed boundary. It can reach the trusted runtime and outside world only through capabilities explicitly exposed by the application's API.](/img/typed-sandbox.svg)

## Put authority in code

The relevant question is not whether prompts can be subverted, but what
authority remains after they are. Does the agent inherit a shell, raw
credentials, and broad service clients, or is it confined to the few domain
operations its role requires?

Harpe makes that boundary part of the application:

- the prompt defines the role
- a typed API defines the only operations available to generated code
- trusted code keeps credentials, tenant scope, and validation outside the
  model's reach

Ask for anything beyond that API and compilation fails before execution. The
grant is fine-grained, visible in versioned source, and checked for every
generated program.

## Why let the agent write code?

Code is a compact, composable action language for agents. The CodeAct research
found that executable code actions outperformed common text and JSON action
formats by up to 20% in its benchmarks. Code gives models familiar loops,
branching, error handling, and data transformations instead of forcing every
step through a separate tool call.

It can also keep tools and intermediate data out of the model's context.
Anthropic shows agents loading tool definitions on demand and filtering results
in the execution environment. Cloudflare's Code Mode applies the same idea to
its API: code acts as a compact plan that can discover and compose operations
while returning only the data the model needs.

But executing model-written code creates an authority problem. Harpe's answer
is to compile each program against a narrow API. The agent gets the expressive
power of code without ambient access to the host or application.

## When Harpe fits

Choose Harpe when:

- the agent has a clear role and a known set of external systems
- authority must be narrow, reviewable, and enforced before execution
- you want to own the application, approvals, memory, and interaction model

If you want an autonomous assistant with broad access to a changing repository
and development environment, use a code agent. Use Harpe to build the bounded
agent itself.

Next: see why [compile-time sandboxing](/overview/compile-time-sandboxing/)
makes those boundaries durable.

## References

- [Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030)
- [Code execution with MCP: Building more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Code Mode: give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
