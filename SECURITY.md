# Security Policy

Harpe runs code written by a language model. Its central security claim is the
capability boundary: a generated Jo program is compiled against the capabilities
the application granted, and code that asks for anything else does not compile.
Security reports against that boundary are taken seriously.

## Reporting a Vulnerability

Do not report security vulnerabilities in public issues, pull requests, or
discussions.

Use GitHub private vulnerability reporting for this repository. If private
vulnerability reporting is not available, contact the maintainers privately
before sharing details publicly.

When reporting a vulnerability, include:

- A short description of the issue
- Steps to reproduce it
- A minimal agent, capability interface, or generated program, if applicable
- Expected behavior
- Actual behavior
- Any known impact or workaround

## Out of Scope

- **Prompt injection within granted authority.** Text that persuades the model to
  misuse a capability it was legitimately given is the model doing granted work.
  The mitigation is to grant less, or to require
  [human approval](docs/content/concepts/approvals.md) in the implementation. It
  is a design discussion, not a vulnerability report.
- **Capabilities an application chose to grant.** An agent handed a shell, an
  unconfined filesystem, or an unapproved payment operation behaves as
  configured. See the deployment checklist in
  [`docs/content/guides/production.md`](docs/content/guides/production.md).
- **Resource exhaustion inside the guest.** CPU, memory, and disk limits are a
  documented gap in the compile-time boundary. `runCode` applies wall-clock
  timeouts and a concurrency bound. Finer confinement belongs in the optional
  `sandbox/run.sh` wrapper described in
  [Add Defense in Depth](docs/content/guides/defense-in-depth.md).
- **Model output quality.** Wrong answers, hallucinated file names, and
  non-compiling programs are handled by the turn loop, not by this policy.

If you are unsure which side a finding falls on, report it privately and say so.

## Supported Versions

Harpe is early-stage software in developer preview. Until the first stable
release, security fixes are applied to the main development branch and shipped in
the next release.

Published package versions are immutable. A fix is released as a new version
rather than a replacement of the affected one, so upgrading is the only remedy
for a vulnerable release.

## Disclosure

Please give the maintainers reasonable time to investigate and fix confirmed
issues before public disclosure.
