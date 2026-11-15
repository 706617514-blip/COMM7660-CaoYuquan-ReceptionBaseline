#!/usr/bin/env bash
# Wait for the ARK batch to finish, then run the post-generation pipeline.
#
# Exists so a 77-minute unattended batch does not sit idle until someone
# notices it finished. Completion is detected by the generator writing a final
# "[172/172]" line (its own count of what it selected), NOT by counting files:
# a file count cannot tell "finished" apart from "died after N images", and the
# earlier run was killed mid-batch exactly that way.
#
# Usage: bash docs/art/watch_and_run.sh [logfile] [expected_count]

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LOG="${1:-/tmp/gen_v2.log}"
EXPECT="${2:-172}"
POLL=30

echo "watching $LOG for $EXPECT images"

# Fail fast if the generator is already dead without reaching the target.
dead_polls=0
while true; do
  done_count=$(grep -c '^\[' "$LOG" 2>/dev/null || echo 0)
  ok_count=$(grep -c ' OK   ' "$LOG" 2>/dev/null || echo 0)

  if [ "$done_count" -ge "$EXPECT" ]; then
    echo "batch finished: $ok_count ok of $EXPECT"
    break
  fi

  if ! pgrep -f gen_direct.py >/dev/null 2>&1; then
    dead_polls=$((dead_polls + 1))
    if [ "$dead_polls" -ge 2 ]; then
      echo "generator is gone at $done_count/$EXPECT - not running pipeline" >&2
      echo "PARTIAL BATCH: $ok_count ok. Inspect $LOG before continuing." >&2
      exit 1
    fi
  else
    dead_polls=0
  fi

  sleep "$POLL"
done

echo
bash docs/art/run_pipeline.sh
