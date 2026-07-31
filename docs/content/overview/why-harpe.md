+++
title = "Why Harpe?"
+++
Harpe is a framework for building **specialized agents** with boundaries
enforced by [compile-time sandboxing](/overview/compile-time-sandboxing/). It is
not a coding agent for developing a software repository.

A Harpe agent has a particular job: review a pull request, process a document,
operate an internal workflow, answer through a support channel, or coordinate
another bounded task. You decide which capabilities that job requires. The
agent can write small Jo programs to combine those capabilities, but it cannot
reach beyond the interface you gave it.

Harpe targets agents that work with critical infrastructure, sensitive data,
or consequential operations—settings where broad access is unacceptable and
fine-grained permissions matter. Their boundaries should be clear enough to
review and strong enough to enforce independently of the model's instructions.

## Specialization over general access

General-purpose agents are often given a shell, a filesystem, and broad network
access, then constrained mainly through instructions. That is useful when the
job itself is open-ended software development. It is a poor fit when an agent
should have narrow, durable authority.

Harpe starts from the opposite direction:

- the application defines the agent's purpose, interaction model, and context
- a typed sandbox API defines everything model-written code may do
- the Jo compiler rejects programs that request capabilities outside that API
- optional process isolation supplies a second, independent boundary

The boundary is executable architecture rather than a sentence in a system
prompt.

## Why let the agent write code?

A fixed collection of tool calls can become awkward when a task needs loops,
branching, transformations, or several operations composed together. Harpe lets
the model express that logic as a small typed program for the current turn.

The code is a means of operating the specialized agent—not permission to edit
the agent itself. It compiles against the capabilities selected by the
application, runs, and returns its result. An unavailable capability does not
compile.

## When Harpe fits

Harpe is a good fit when:

- the agent has a clear role and a known set of external systems
- authority should be reviewable in source code
- generated actions should be checked before execution
- you want to own the application loop, memory, approvals, and user experience
- different deployments need different, least-authority capability sets

Harpe is probably not the right abstraction when you want an autonomous coding
assistant with unrestricted access to a changing repository and development
environment. Use a code agent for that. Use Harpe when you are developing the
bounded agent itself.

Next: see why [compile-time sandboxing](/overview/compile-time-sandboxing/)
makes those boundaries durable.
