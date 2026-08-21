#!/usr/bin/env bash
#
# Enforce the file allowlist declared in a code-health issue against the PR that
# claims to implement it.
#
# This exists because an out-of-scope line in an issue body is the weakest tier
# of enforcement available -- types beat lint and CI, which beat agent review,
# which beats a prompt instruction. Asking the implementer nicely to stay in
# scope works until the run where it doesn't, and then a rename arrives as a
# 400-file restructure that nobody wants to review.
#
# Usage (from the implementer workflow):
#   check-allowlist.sh <issue-number> <base-ref>

set -euo pipefail
shopt -s globstar extglob

issue="${1:?issue number required}"
base="${2:-origin/main}"

body=$(gh issue view "$issue" --json body --jq '.body')

# Allowlist is embedded by the audit as an HTML comment, same mechanism as the
# fingerprint block, so it survives editing of the prose above it.
allowlist=$(sed -n '/<!-- code-health-allowlist/,/-->/p' <<< "$body" \
  | sed '1d;$d' | sed 's/[[:space:]]*$//' | grep -v '^$' || true)

if [ -z "$allowlist" ]; then
  echo "::error::Issue #${issue} has no allowlist block; refusing to validate an unbounded change."
  exit 1
fi

changed=$(git diff --name-only "$base"...HEAD)
if [ -z "$changed" ]; then
  echo "No files changed."
  exit 0
fi

violations=()
while IFS= read -r file; do
  [ -z "$file" ] && continue
  ok=false
  while IFS= read -r pattern; do
    # Patterns are globs relative to repo root. A trailing /** covers a subtree.
    # shellcheck disable=SC2053
    if [[ "$file" == $pattern ]]; then ok=true; break; fi
  done <<< "$allowlist"
  $ok || violations+=("$file")
done <<< "$changed"

echo "::group::Allowlist for issue #${issue}"
echo "$allowlist"
echo "::endgroup::"

if [ ${#violations[@]} -gt 0 ]; then
  echo "::error::${#violations[@]} file(s) outside the allowlist for issue #${issue}:"
  printf '  %s\n' "${violations[@]}"
  echo ""
  echo "Either narrow the change, or amend the issue's allowlist and say why in the PR."
  exit 1
fi

echo "All $(wc -l <<< "$changed") changed file(s) are within the allowlist."