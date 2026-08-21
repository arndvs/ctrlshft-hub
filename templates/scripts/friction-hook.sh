#!/usr/bin/env bash
#
# Session-end hook: extract mechanical friction signals from the transcript.
#
# Registered as a Stop/SessionEnd hook so it fires unconditionally. A final task
# in the prompt gets dropped when a session ends messily -- and messy endings are
# exactly the high-friction sessions most worth recording, so relying on the
# prompt biases the data against the cases that matter most.
#
# This must never fail the session. Everything below is best-effort; a friction
# store that occasionally misses a session is fine, a hook that breaks people's
# work gets removed within a day.

set -uo pipefail   # deliberately not -e: see above

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STORE="${FRICTION_STORE:-$REPO_ROOT/.friction}"
COLLECTOR="$REPO_ROOT/.sandcastle/scripts/collect-friction.py"
LOG="${TMPDIR:-/tmp}/friction-hook.log"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

if ! command -v python3 >/dev/null 2>&1; then
  log "python3 unavailable; skipping"
  exit 0
fi

# Hook payload arrives on stdin as JSON; the transcript path is the only field
# needed. Parsed with python rather than jq -- python is already required by the
# collector, and jq is frequently absent on developer machines, where a silently
# inert hook would be worse than a missing one.
payload=$(cat 2>/dev/null || true)
transcript=""
if [ -n "$payload" ]; then
  transcript=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("transcript_path") or d.get("transcriptPath") or "")
except Exception:
    print("")
' 2>/dev/null || true)
fi
[ -z "$transcript" ] && transcript="${CLAUDE_TRANSCRIPT_PATH:-}"

if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
  log "no transcript available; skipping"
  exit 0
fi

if [ ! -f "$COLLECTOR" ]; then
  log "collector not found at $COLLECTOR; skipping"
  exit 0
fi

# Cap runtime. The collector is fast, but a pathological transcript should not
# hold a session open.
if command -v timeout >/dev/null 2>&1; then
  RUN=(timeout 30 python3 "$COLLECTOR")
else
  RUN=(python3 "$COLLECTOR")
fi

if out=$("${RUN[@]}" \
      --transcript "$transcript" \
      --out-dir "$STORE" \
      --harness "${FRICTION_HARNESS:-claude-code}" 2>&1); then
  log "ok: $out"
else
  log "collector failed (non-fatal): $out"
fi

exit 0