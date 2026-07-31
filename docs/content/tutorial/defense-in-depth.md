+++
title = "Add Defense in Depth"
+++
Compile-time sandboxing gives generated programs fine-grained permissions
through typed capabilities. However, compile-time sandboxing does not limit CPU
and memory usage. You can enforce those limits with OS-level mechanisms. You
may also add file and network rules for defense in depth.

This tutorial configures the `sandbox/run.sh` wrapper shipped by the CLI, web,
and Telegram templates.

## What Harpe already applies

`runCode` always:

- compiles and runs each program in an isolated temporary directory
- enforces wall-clock timeouts
- kills the whole process group on timeout
- limits captured output
- gives the guest `PATH`, its audit-log path, and the key/value pairs the
  application explicitly provides to the sandbox runtime

The trusted compile step keeps the toolchain environment. The guest does not
inherit other host variables. Treat every explicitly provided value as visible
to guest code.

These protections do not restrict filesystem or network access. Add those
restrictions in `run.sh`.

## Enable the wrapper

From a generated CLI, web, or Telegram project:

```sh
cp sandbox/run.sh.example sandbox/run.sh
chmod +x sandbox/run.sh
```

When this executable exists, Harpe runs:

```text
sandbox/run.sh <generated-program.py>
```

The wrapper must finish by executing a Python interpreter with `"$@"`. Start
with the example unchanged and confirm the agent can still run a calculation.

## 1. Limit resources

Add limits before the final `exec`:

```sh
ulimit -v 1048576   # about 1 GiB of address space
ulimit -t 30        # 30 CPU-seconds
exec python3 "$@"
```

The wall-clock timeout catches hangs. These limits constrain memory, CPU time,
and CPU consumption.

For accounted limits shared by a process tree, use cgroups, a systemd scope, or
container limits instead. Use those mechanisms to limit process creation too.

## 2. Restrict the filesystem

The generated program only needs its run directory and the system files needed
to start Python. Use one of the following allowlists.

With [landrun](https://github.com/Zouuup/landrun):

```sh
exec landrun \
  --ro /usr /lib /lib64 /etc \
  --rw "$(dirname "$1")" \
  -- python3 "$@"
```

With bubblewrap:

```sh
exec bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --bind "$(dirname "$1")" "$(dirname "$1")" \
  -- python3 "$@"
```

Paths differ across Linux distributions. Add only the runtime paths your Python
installation needs. Do not bind the project directory, `.env`, SSH keys, or
another session's data.

Test the boundary with an agent program that tries to read a known file outside
the allowlist. The call should fail while an ordinary calculation still works.

## 3. Restrict the network

If guest programs need no network, add a private network namespace:

```sh
exec bwrap \
  --ro-bind /usr /usr \
  --ro-bind /lib /lib \
  --ro-bind /lib64 /lib64 \
  --ro-bind /etc /etc \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --bind "$(dirname "$1")" "$(dirname "$1")" \
  --unshare-net \
  -- python3 "$@"
```

If a capability needs network access, prefer keeping that access in trusted
runtime code. Do not give the generated guest general network access merely
because one capability calls an API.

For host-level filtering, run guests under a dedicated account and apply
nftables or your platform's equivalent to that account. Switching users
requires carefully scoped operator privileges. Configure it in the service
manager rather than giving the agent unrestricted `sudo`.

## Use an existing isolation stack

`run.sh` is an integration seam. It can hand the generated program to Docker,
Podman, gVisor, Kata, or a microVM instead of invoking Python directly.

For example:

```sh
exec docker run --rm \
  --network none \
  --memory 1g \
  --cpus 1 \
  --read-only \
  -v "$(dirname "$1"):$(dirname "$1"):ro" \
  python:3.12-slim \
  python3 "$@"
```

Use the isolation system your team already operates and monitors.

## Verify before deployment

Exercise each boundary explicitly:

1. Run a normal calculation.
2. Trigger a long loop and confirm the timeout stops it.
3. Try to read a file outside the allowed directory.
4. Try an outbound connection when networking should be disabled.
5. Confirm the guest environment contains only `PATH`, the audit path, and the
   values your application intentionally grants.
6. Review `logs/agent.jsonl` for the recorded tool result.

Do not treat the wrapper as enabled merely because `run.sh.example` exists.
Harpe uses it only when the file is named `run.sh` and is executable.

The [compile-time sandbox concept](/concepts/sandbox/) explains the primary
capability boundary that these OS controls reinforce.
