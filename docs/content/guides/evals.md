+++
title = "Evals"
description = "Measure agent success, compare changes, and test prompt injection before deployment."
+++

An agent that handles a request well today may handle it differently tomorrow,
after a new prompt, a new skill, or a provider update. This guide covers how to
prevent regression in the performance of agents.

## What evals are and why they matter

Evals (short for evaluations) are repeatable tests of an agent's behavior. You
give the agent representative tasks, check its answers and actions against clear
success criteria, and measure the **success rate**: the percentage of runs that
meet all required criteria.

Agents can behave differently on the same request. Changing a prompt, context
strategy, skill, tool, or model provider can improve one task while breaking
another. A few successful demos cannot tell you how reliable the agent is.

Success rate is important, but it is not the whole story. The same
change that raises it can also make turns slower, cost more per task, or leave
the agent open to prompt injection attacks. A deployment has
to meet all the requirements, so production-grade evals need to measure latency, cost, and resistance to
attacks alongside success rate.

## Define success

Each case needs a user request and clear pass conditions.
For example:

> Draft an order for 10 units of SKU-42 for warehouse W1. Do not submit it.

A pass means exactly one correct draft exists for the authorized tenant, no
order was submitted, and the answer describes what happened accurately. Check
the stored state and effects alongside the reply.

Use code to check records, artifacts, permissions, and approvals. For qualities
such as clarity, use a narrow rubric and calibrate any model grader against
human-reviewed examples. Keep expected answers and grading instructions outside
the agent's accessible context and files.

**Build a representative case set**.
Start with a small collection of real workflows and known failures. Include
ambiguous requests, missing data, and cases where clarification or refusal is
correct.

## Compare repeatable runs

Run the same workflow with the real model, production capability restrictions,
and approval checks. Use isolated files, test databases, and recording services
for external effects.

Record the case set, application revision, prompts, skills, context settings,
provider and model, budgets, and grader version. Hold these fixed except for
the change being evaluated.

Repeat each case several times under both configurations:

```text
success rate = runs passing every required check / total runs
```

Report counts and success rates by workflow, alongside latency and
[cost](/guides/usage-and-billing/). Inspect individual regressions, and use
confidence intervals when differences are small. A suite dominated by easy
questions can hide failures in consequential operations.

### In Harpe

Use the application's [Agent.ask](/concepts/turn/) setup and keep a
[log](/concepts/logging/) for each run. `TurnResult.Success` indicates normal
completion. Grade the task using the returned `TurnData` and observed effects.

For [approval tests](/concepts/approvals/), supply a scripted `Interact` and
record requests and decisions. Cover approval, rejection, and timeout.

## Test prompt injection

Measure both **legitimate task success** and **attacker success**. Refusing
everything may prevent an attack while making the agent useless. Inspect actual
effects and data exposure. A refusal in the final answer is insufficient.

Record where the attack was encountered or blocked. A run that never encounters
the attack is not evidence of resistance. Use synthetic secrets and test
outboxes for leakage checks, and include attacks that persist through later
turns or context compaction.

Harpe's [sandbox](/overview/compile-time-sandboxing/) limits generated code's
capabilities. Evals must also cover misuse of granted capabilities and
host-side tools. Keep deterministic permission and approval tests alongside
behavioral evals.

