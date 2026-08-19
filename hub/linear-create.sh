#!/usr/bin/env bash
# linear-create.sh — Create a Linear issue in a team via the GraphQL API.
# Reads title + description from files (avoids shell escaping hell).
#
# Usage: linear-create.sh <TEAM_ID> <STATE_ID> <TITLE_FILE> <DESC_FILE>
# Prints: "<IDENTIFIER> <URL>" on success, exits non-zero on failure.
#
# The ARNDVS_LINEAR key is injected at runtime by run-with-secrets.sh — never
# read or echo the key directly.

set -euo pipefail

TEAM_ID="${1:?team id required}"
STATE_ID="${2:?state id required}"
TITLE_FILE="${3:?title file required}"
DESC_FILE="${4:?description file required}"

# Build the GraphQL payload with python (handles JSON escaping correctly),
# write it to a temp file, and pass it to curl with --data @file (no shell
# interpretation of the payload).
payload_file="$(mktemp)"
trap 'rm -f "$payload_file"' EXIT

TEAM_ID="$TEAM_ID" STATE_ID="$STATE_ID" TITLE_FILE="$TITLE_FILE" DESC_FILE="$DESC_FILE" \
python3 - "$payload_file" <<'PY'
import json, os, sys

team_id = os.environ["TEAM_ID"]
state_id = os.environ["STATE_ID"]
title = open(os.environ["TITLE_FILE"], encoding="utf-8").read().strip()
desc = open(os.environ["DESC_FILE"], encoding="utf-8").read()

query = """mutation {
  issueCreate(input: {
    teamId: "%s",
    title: %s,
    description: %s,
    stateId: "%s"
  }) { success issue { identifier url } }
}""" % (
    team_id,
    json.dumps(title),
    json.dumps(desc),
    state_id,
)

payload = json.dumps({"query": query})
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write(payload)
PY

response="$(
  ~/dotfiles/bin/run-with-secrets.sh --only ARNDVS_LINEAR -- bash -c \
    'curl -s -X POST https://api.linear.app/graphql \
      -H "Authorization: $ARNDVS_LINEAR" \
      -H "Content-Type: application/json" \
      --data @"$1"' _ "$payload_file"
)"

# Parse the response for success + identifier.
echo "$response" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except json.JSONDecodeError:
    print("non-JSON response:", sys.stdin.read()[:300], file=sys.stderr)
    sys.exit(1)
created = data.get("data", {}).get("issueCreate", {})
if created.get("success"):
    issue = created["issue"]
    ident = issue["identifier"]
    url = issue["url"]
    print(ident + " " + url)
else:
    errs = data.get("errors", [])
    print("Linear error:", errs[0].get("message", errs[0]) if errs else "unknown", file=sys.stderr)
    sys.exit(1)
'