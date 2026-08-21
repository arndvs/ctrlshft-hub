#!/usr/bin/env bash
#
# Collects fingerprints of findings the audit should NOT propose again, and
# writes them to $KNOWN_FILE for the agent to read.
#
# Three categories, with different semantics:
#   open      - already filed and awaiting action. Don't refile.
#   fixed     - closed as completed. Don't refile; if it regressed, that's a
#               legitimate new finding, so these expire after the cooldown too.
#   declined  - closed as not_planned. A human looked and said no. Suppressed
#               for DECLINED_COOLDOWN_DAYS so the agent can't relitigate it
#               every week.
#
# The distinction matters: without it, the first declined finding gets refiled
# on the next run and the audit becomes something people mute.

set -euo pipefail

: "${KNOWN_FILE:?KNOWN_FILE must be set}"
: "${LABEL:?LABEL must be set}"
COOLDOWN_DAYS="${DECLINED_COOLDOWN_DAYS:-90}"

cutoff=$(date -u -d "${COOLDOWN_DAYS} days ago" +%Y-%m-%dT%H:%M:%SZ)

echo "Collecting known findings (label=${LABEL}, cooldown=${COOLDOWN_DAYS}d, cutoff=${cutoff})"

fetch() {
  local state="$1" reason_filter="$2"
  # --search bounds the query; without it a long-lived repo pages through
  # hundreds of closed issues on every run.
  gh issue list \
    --label "$LABEL" \
    --state "$state" \
    --limit 200 \
    --json number,body,closedAt,stateReason \
    --jq "$reason_filter"
}

# Fingerprints live in an HTML comment block appended by the publish step:
#   <!-- code-health-fingerprints
#   naming:src/models.py:QueryRequest
#   -->
extract_fingerprints() {
  sed -n '/<!-- code-health-fingerprints/,/-->/p' \
    | sed '1d;$d' \
    | sed 's/[[:space:]]*$//' \
    | grep -v '^$' || true
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

: > "$tmp/open.txt"
: > "$tmp/fixed.txt"
: > "$tmp/declined.txt"

# Open issues — always suppressed, no expiry.
if ! open_json=$(fetch open '.[] | @base64' 2>&1); then
  echo "::error::Failed to list open issues: $open_json"
  exit 1
fi
while IFS= read -r row; do
  [ -z "$row" ] && continue
  echo "$row" | base64 -d | jq -r '.body // ""' | extract_fingerprints >> "$tmp/open.txt"
done <<< "$open_json"

# Closed issues — split by reason, and only those inside the cooldown window.
if ! closed_json=$(fetch closed ".[] | select(.closedAt >= \"$cutoff\") | @base64" 2>&1); then
  echo "::error::Failed to list closed issues: $closed_json"
  exit 1
fi
while IFS= read -r row; do
  [ -z "$row" ] && continue
  decoded=$(echo "$row" | base64 -d)
  reason=$(echo "$decoded" | jq -r '.stateReason // "COMPLETED"')
  target="$tmp/fixed.txt"
  [ "$reason" = "NOT_PLANNED" ] && target="$tmp/declined.txt"
  echo "$decoded" | jq -r '.body // ""' | extract_fingerprints >> "$target"
done <<< "$closed_json"

jq -n \
  --arg cutoff "$cutoff" \
  --argjson cooldown "$COOLDOWN_DAYS" \
  --rawfile open "$tmp/open.txt" \
  --rawfile fixed "$tmp/fixed.txt" \
  --rawfile declined "$tmp/declined.txt" \
  '{
     cooldownDays: $cooldown,
     cutoff: $cutoff,
     open:     ($open     | split("\n") | map(select(length > 0)) | unique),
     fixed:    ($fixed    | split("\n") | map(select(length > 0)) | unique),
     declined: ($declined | split("\n") | map(select(length > 0)) | unique)
   }' > "$KNOWN_FILE"

echo "open=$(jq '.open | length' "$KNOWN_FILE")" \
     "fixed=$(jq '.fixed | length' "$KNOWN_FILE")" \
     "declined=$(jq '.declined | length' "$KNOWN_FILE")"