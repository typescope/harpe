#!/bin/sh
# Test wrapper for the runCode integration tests. Its presence proves the run.sh
# seam is honored (the guest runs THROUGH this script), and the marker line shows
# whether a host secret leaked into the child environment. The runner launches
# guest code with a minimal (PATH-only) env, so ${ANTHROPIC_API_KEY} must come
# back empty even when the parent process has it set.
echo "harpe-run-sh key=[${ANTHROPIC_API_KEY}]"
exec python3 "$@"
