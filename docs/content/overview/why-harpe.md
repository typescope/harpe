+++
title = "Why Harpe?"
+++
Harpe is a framework for building **specialized agents**.

It is designed for agentic workflows that rely on code generation to act on
critical infrastructure and sensitive data, or to perform consequential
operations.

<aside class="callout-warning" role="note" aria-labelledby="preview-warning">
  <p class="callout-title" id="preview-warning">Developer preview</p>
  <p>Harpe is in developer preview and ready for serious experimentation.
  The public APIs are still stabilizing and may change between releases.</p>
</aside>

## Why specialized agents?

A general-purpose agent is usually granted with broad authorities.
It can cause severe security issues when the agent is manipulated by either malicious prompt or incorrect AI instruction.

A specialized agent has a pre-defined role, so its authority can be
scoped and checked. That is the
[**principle of least authority**](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
(PoLA), and we believe it is the right way to make an agent fit for high-stake
critical infrastructure and sensitive data use cases.

![A general agent and a specialized agent side by side. The same five systems appear in both as bubbles: database, REST APIs, files, shell and email. For the general agent every bubble is open, so all of every system is in reach. For the specialized agent three bubbles are masked out entirely, and the two that remain are open only over a small patch of themselves.](/img/general-vs-specialized.svg)

## A typed authority boundary

Harpe enforces fine-grained permissions through
[compile-time sandboxing](/overview/compile-time-sandboxing/).

![Model-generated code is confined behind a typed boundary. It can reach the trusted runtime and outside world only through capabilities explicitly exposed by the application's API.](/img/typed-sandbox.svg)

For each agent action step, the model writes a Jo program. Harpe compiles it as an
untrusted guest against capability interfaces predefined by the application.
Trusted implementations retain credentials, tenant scope, and validation.

The capability interface scopes the agent's authority:

- broad authority can be attenuated into narrow domain operations, such as
a read-only, tenant-scoped query
- undeclared capabilities, FFI, and ambient host access are unavailable
- the compiler checks direct and transitive capability usage

## Why let the agent write code?

Programming is more flexible and efficient than using fixed tools. It provides loops, branching, error handling,
and data transformation without routing every intermediate value through the
model.

This is not unique to Harpe. CodeAct
[[1]](#reference-codeact) evaluated 17 LLMs on API-Bank and M³ToolEval, a
benchmark of its own, and reported up to a
20% higher success rate for code than
for the common text and JSON action formats.

![Task success rate by action format on the M³ToolEval benchmark. GPT-4-1106 scores 74.4% with code against 52.4% with JSON and 53.7% with text. Claude-2 scores 54.9% against 39.0% and 29.3%. GPT-3.5-turbo scores 51.2% against 26.8% and 20.7%. These are three of the seventeen models evaluated, and code came first on twelve of them.](/img/codeact-success-rate.svg)

Anthropic
[[2]](#reference-anthropic) and Cloudflare
[[3]](#reference-cloudflare) have also shown how code execution can reduce
tool-schema overhead, compose operations, and process intermediate data outside
the model context.

## Minimizing attack surface

A sandbox's security also depends on the surface area that untrusted code can reach.
In *VMs won't contain cyber-capable agents* [[4]](#reference-trail-of-bits),
Trail of Bits reports an agent escaping a QEMU/KVM virtual machine by chaining
vulnerabilities in its virtualization and networking stack.

Harpe can reduce attack surface by narrowing the capability interface. A calendar agent
can be granted capabilities to only check availability and reserve a slot,
without accessing credentials and network. In Harpe, the
LLM-generated code has no ambient access to a shell, file system, raw sockets, or virtual devices.

## The cost and benefits of typed trust boundaries

To develop a secure specialized agent, the trust boundary has to be defined
explicitly. You design the capability interfaces the agent acts through, and
provide trustworthy implementations behind them. The compiler verifies generated
code can only use explicitly granted capabilities.

In an ACM Queue article, *Safe Coding* [[5]](#reference-safe-coding),
Christoph Kern distills decades of Google's security engineering into a principle
of rigorous modular reasoning:

> ... the safety of risky operations within an abstraction must rely solely on
> assumptions supported by the abstraction's APIs and type signatures.
> Conversely, the composition of safe abstractions with safe code (i.e., code
> free of risky operations, which constitutes the vast majority of a program) is
> automatically verified by the implementation language's type checker.

That is the benefit of a type-checked trust boundary: you pay once in designing the
capability interfaces, and every program LLMs write against them is checked by the
compiler rather than by a reviewer.

Next: see why [compile-time sandboxing](/overview/compile-time-sandboxing/)
makes those boundaries durable.

## References

1. <span id="reference-codeact"></span>[Executable Code Actions Elicit Better
   LLM Agents](https://arxiv.org/abs/2402.01030). Wang et al., 2024.
2. <span id="reference-anthropic"></span>[Code execution with MCP: Building
   more efficient
   agents](https://www.anthropic.com/engineering/code-execution-with-mcp).
   Anthropic, 2025.
3. <span id="reference-cloudflare"></span>[Code Mode: give agents an entire API
   in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/). Cloudflare, 2026.
4. <span id="reference-trail-of-bits"></span>[VMs won't contain cyber-capable
   agents](https://blog.trailofbits.com/2026/08/26/vms-wont-contain-cyber-capable-agents/).
   Artem Dinaburg, Trail of Bits, 2026.
5. <span id="reference-safe-coding"></span>[Safe Coding: Rigorous modular
   reasoning about software safety](https://queue.acm.org/doi/10.1145/3773098).
   Christoph Kern, 2025.
