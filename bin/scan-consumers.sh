#!/usr/bin/env bash
# scan-consumers.sh — Generate the volatile consumer-fleet report.
#
# Reads the committed identity manifest (consumers.manifest.json) and
# produces a gitignored report (consumers.report.json) with the volatile
# state that must NOT live in git: pinned SHAs, detected/reviewed dates,
# review lag, pending-pin flags, stale-ref flags, and AGENT_PAT presence.
#
# IMPORTANT: All repo state is read from the REMOTE DEFAULT BRANCH
# (origin/HEAD), never the working tree. Consumers are frequently checked
# out on feature branches (drift PRs, hub-rename branches); reading the
# working tree would report unmerged branch state as fleet truth.
#
# Usage:
#   bash bin/scan-consumers.sh              # generate report + human table
#   bash bin/scan-consumers.sh --check      # exit non-zero on hard failures
#   bash bin/scan-consumers.sh --json       # print report JSON only
#   bash bin/scan-consumers.sh --ci         # resolve repo state via GitHub API
#                                           # (no local clones required — for
#                                           # CI runners that only have the
#                                           # workspaces repo checked out)
#
# Hard failures (exit 1 with --check):
#   - manifest path does not resolve to a git repo on disk (local mode)
#   - model:hub consumer has a stale sandcastle-hub ref in a workflow
#   - model:hub consumer is missing AGENT_PAT secret (definitive 404 only —
#     a 403 means the token cannot verify, reported as "unknown", not a failure)
#   - model:hub consumer is missing .sandcastle/hub-version.json on default branch
#
# Soft warnings (reported, no exit):
#   - reviewLag > 0 (pinned SHA behind hub main)
#   - pendingPin (working tree has a newer pin than default branch; local only)
#   - unclassified repos (informational)
#
# Requires: jq, gh (for secret + hub-SHA checks), git.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/ctrlshft-consumers/consumers.manifest.json"
REPORT="$ROOT/ctrlshft-consumers/consumers.report.json"
CLIENTS="${CLIENTS:-$HOME/dev/clients}"
HUB_DIR="${HUB_DIR:-$HOME/dev/clients/ctrlshft-hub}"

CHECK_ONLY=false
JSON_ONLY=false
CI_MODE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --check) CHECK_ONLY=true; shift ;;
        --json)  JSON_ONLY=true; shift ;;
        --ci)    CI_MODE=true; shift ;;
        -h|--help)
            echo "Usage: scan-consumers.sh [--check] [--json] [--ci]"
            echo "  --check   Exit non-zero on hard failures (CI mode)."
            echo "  --json    Print report JSON only."
            echo "  --ci      Resolve repo state via GitHub API (no local clones)."
            exit 0 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

if [[ ! -f "$MANIFEST" ]]; then
    echo "ERROR: manifest not found: $MANIFEST" >&2
    exit 1
fi

# ── Resolve hub latest SHA ────────────────────────────────────────────────────
HUB_LATEST=""
if command -v gh &>/dev/null; then
    HUB_LATEST=$(gh api repos/arndvs/ctrlshft-hub/commits/main --jq '.sha' 2>/dev/null | cut -c1-7 || true)
fi

# ── Walk the manifest ─────────────────────────────────────────────────────────
HARD_FAIL=0
SOFT_WARN=0
REPORT_JSON='{"hubLatestSha":"'"$HUB_LATEST"'","generatedAt":"'"$(date +%Y-%m-%dT%H:%M:%S%z)"'","repos":[]}'

while IFS= read -r repo_json; do
    [[ -n "$repo_json" ]] || continue
    path=$(jq -r '.path' <<<"$repo_json")
    name=$(jq -r '.name' <<<"$repo_json")
    role=$(jq -r '.role' <<<"$repo_json")
    model=$(jq -r '.model' <<<"$repo_json")
    status=$(jq -r '.status' <<<"$repo_json")
    # GitHub owner/name (owner/name). Added to the manifest so CI mode can
    # resolve repos via the API without local clones. Falls back to the
    # owner + name fields when absent (best-effort).
    repo_spec=$(jq -r '.repo // ""' <<<"$repo_json")
    if [[ -z "$repo_spec" ]]; then
        owner=$(jq -r '.owner // ""' <<<"$repo_json")
        repo_spec="${owner:+$owner/}$name"
    fi

    # Path-derived unique id (name is not unique — mcrdse-ops appears twice).
    id=$(echo "$path" | sed 's|^\.\./clients/||; s|/|__|g')

    # Resolve the repo dir relative to the manifest location.
    repo_dir="$CLIENTS/$(echo "$path" | sed 's|^\.\./clients/||')"

    # Build the entry with jq -n so all values are properly escaped.
    entry=$(jq -n \
        --arg id "$id" \
        --arg name "$name" \
        --arg path "$path" \
        --arg role "$role" \
        --arg model "$model" \
        --arg status "$status" \
        --arg repo "$repo_spec" \
        '{id:$id, name:$name, path:$path, role:$role, model:$model, status:$status, repo:$repo}')

    # ── CI mode: resolve repo state via GitHub API ────────────────────────────
    # CI runners only have the workspaces repo checked out, not the consumers.
    # Read hub-version.json from the default branch via the API instead of
    # local git. The AGENT_PAT secret check below already uses the API.
    if [[ "$CI_MODE" == true ]]; then
        if [[ -z "$repo_spec" ]] || [[ "$repo_spec" == "/" ]]; then
            entry=$(jq '. + {error:"no repo spec in manifest (--ci mode)"}' <<<"$entry")
            HARD_FAIL=$((HARD_FAIL + 1))
            REPORT_JSON=$(jq --argjson e "$entry" '.repos += [$e]' <<<"$REPORT_JSON")
            continue
        fi

        pinned=""
        detected=""
        reviewed=""
        # hub-version.json on the default branch (via API).
        hubver_json=$(gh api "repos/$repo_spec/contents/.sandcastle/hub-version.json" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || true)
        if [[ -n "$hubver_json" ]]; then
            pinned=$(jq -r '.lastPinnedSha // ""' <<<"$hubver_json" 2>/dev/null || true)
            detected=$(jq -r '.detectedAt // ""' <<<"$hubver_json" 2>/dev/null || true)
            reviewed=$(jq -r '.reviewedAt // ""' <<<"$hubver_json" 2>/dev/null || true)
        fi

        # No working tree in CI — pendingPin and derivedReviewedAt are local-only.
        pending_pin=false
        derived_reviewed=""

        # Stale sandcastle-hub ref check via API (list workflow files).
        stale_ref=false
        if [[ "$model" == "hub" ]] && [[ "$role" != "hub" ]]; then
            wf_list=$(gh api "repos/$repo_spec/contents/.github/workflows" --jq '.[].name' 2>/dev/null || true)
            if [[ -n "$wf_list" ]] && grep -q "sandcastle-hub" <<<"$wf_list" 2>/dev/null; then
                stale_ref=true
                HARD_FAIL=$((HARD_FAIL + 1))
            fi
        fi

        # AGENT_PAT secret presence (repo level, then org level).
        # The secrets API requires admin on the target repo. A 403 means the
        # token cannot verify — NOT that the secret is absent. Only a 404 is a
        # definitive MISSING (and a hard failure); anything else is "unknown".
        secret=""
        if [[ "$model" == "hub" ]] && [[ "$role" != "hub" ]] && command -v gh &>/dev/null; then
            owner="${repo_spec%%/*}"
            repo_code=$(gh api "repos/$repo_spec/actions/secrets/AGENT_PAT" --silent -i 2>/dev/null | head -1 | awk '{print $2}' || true)
            if [[ "$repo_code" == "200" ]]; then
                secret="present"
            else
                org_code=$(gh api "orgs/$owner/actions/secrets/AGENT_PAT" --silent -i 2>/dev/null | head -1 | awk '{print $2}' || true)
                if [[ "$org_code" == "200" ]]; then
                    secret="present-org"
                elif [[ "$repo_code" == "404" ]] && [[ "$org_code" == "404" ]]; then
                    secret="MISSING"
                    HARD_FAIL=$((HARD_FAIL + 1))
                else
                    secret="unknown"
                fi
            fi
        fi

        # hub-version.json presence for model:hub consumers (not the hub itself).
        if [[ "$model" == "hub" ]] && [[ "$role" != "hub" ]] && [[ -z "$pinned" ]]; then
            HARD_FAIL=$((HARD_FAIL + 1))
        fi

        entry=$(jq \
            --arg pinned "$pinned" \
            --arg detected "$detected" \
            --arg reviewed "$reviewed" \
            --arg derived "$derived_reviewed" \
            --argjson pending "$pending_pin" \
            --argjson stale "$stale_ref" \
            --arg secret "$secret" \
            '. + {pinnedSha:$pinned, detectedAt:$detected, reviewedAt:$reviewed, derivedReviewedAt:$derived, reviewLag:"", pendingPin:$pending, staleSandcastleHubRef:$stale, agentPat:$secret}' \
            <<<"$entry")

        REPORT_JSON=$(jq --argjson e "$entry" '.repos += [$e]' <<<"$REPORT_JSON")

        # ── Human-readable line (suppressed in --json mode) ────────────────────
        if [[ "$JSON_ONLY" != true ]]; then
            printf "%-22s %-12s %-8s %-6s %-12s %-10s %s\n" \
                "$name" "$role" "$model" "${review_lag:-?}" "${secret:-?}" "${pinned:-none}" \
                "$( [[ "$pending_pin" == true ]] && echo "PENDING-PIN!" || echo "" )"
        fi
        continue
    fi

    # A manifest path that doesn't resolve to a git repo is a HARD failure —
    # that's precisely the drift the manifest exists to catch.
    if [[ ! -d "$repo_dir/.git" ]]; then
        entry=$(jq '. + {error:"not a git repo or missing"}' <<<"$entry")
        HARD_FAIL=$((HARD_FAIL + 1))
        REPORT_JSON=$(jq --argjson e "$entry" '.repos += [$e]' <<<"$REPORT_JSON")
        continue
    fi

    # ── Fetch remote default branch ───────────────────────────────────────────
    # Read ALL state from origin/HEAD (the remote default branch), never the
    # working tree. Consumers sit on feature branches (drift PRs, hub-rename
    # branches); the working tree is not fleet truth.
    # Unclassified repos may have no remote configured — fetch only if origin
    # exists, and treat the repo as default-branch-unknown otherwise.
    default_ref=""
    if git -C "$repo_dir" remote get-url origin >/dev/null 2>&1; then
        git -C "$repo_dir" fetch -q origin 2>/dev/null || true
        if git -C "$repo_dir" rev-parse --verify -q origin/HEAD >/dev/null 2>&1; then
            default_ref="origin/HEAD"
        elif git -C "$repo_dir" rev-parse --verify -q origin/main >/dev/null 2>&1; then
            default_ref="origin/main"
        fi
    fi

    # ── Volatile state from default branch ────────────────────────────────────
    pinned=""
    detected=""
    reviewed=""
    if [[ -n "$default_ref" ]]; then
        hubver_blob=$(git -C "$repo_dir" ls-tree "$default_ref" -- .sandcastle/hub-version.json 2>/dev/null | awk '{print $3}')
        if [[ -n "$hubver_blob" ]]; then
            hubver_json=$(git -C "$repo_dir" cat-file -p "$hubver_blob" 2>/dev/null || true)
            pinned=$(jq -r '.lastPinnedSha // ""' <<<"$hubver_json" 2>/dev/null || true)
            detected=$(jq -r '.detectedAt // ""' <<<"$hubver_json" 2>/dev/null || true)
            reviewed=$(jq -r '.reviewedAt // ""' <<<"$hubver_json" 2>/dev/null || true)
        fi
    fi

    # Working-tree pin (for pendingPin detection — a proposed pin that exists
    # locally but was never merged to the default branch).
    wt_pinned=""
    if [[ -f "$repo_dir/.sandcastle/hub-version.json" ]]; then
        wt_pinned=$(jq -r '.lastPinnedSha // ""' "$repo_dir/.sandcastle/hub-version.json" 2>/dev/null || true)
    fi

    # pendingPin: working tree has a newer pin than the default branch.
    pending_pin=false
    if [[ -n "$wt_pinned" ]] && [[ -n "$pinned" ]] && [[ "$wt_pinned" != "$pinned" ]]; then
        pending_pin=true
        SOFT_WARN=$((SOFT_WARN + 1))
    fi

    # Derive reviewedAt from the merge-commit date of the last commit touching
    # hub-version.json on the default branch (the honest "human signed off" date).
    derived_reviewed=""
    if [[ -n "$pinned" ]] && [[ -n "$default_ref" ]]; then
        derived_reviewed=$(git -C "$repo_dir" log -1 --format=%cs "$default_ref" -- .sandcastle/hub-version.json 2>/dev/null || true)
    fi

    # Review lag: distance from pinned SHA to hub main. Uses merge-base so an
    # orphaned pin (SHA not in hub history) is caught, not reported as "behind".
    # The ancestry check runs in the HUB repo (which has full history), not the
    # consumer repo (which only has its own history).
    review_lag=""
    if [[ -n "$pinned" ]] && [[ -n "$HUB_LATEST" ]]; then
        if [[ "$pinned" == "$HUB_LATEST" ]]; then
            review_lag=0
        elif git -C "$HUB_DIR" cat-file -e "$pinned^{commit}" 2>/dev/null \
            && git -C "$HUB_DIR" merge-base --is-ancestor "$pinned" "$HUB_LATEST" 2>/dev/null; then
            # pinned is an ancestor of hub main — count the commits between.
            review_lag=$(git -C "$HUB_DIR" rev-list --count "$pinned..$HUB_LATEST" 2>/dev/null || echo "?")
        else
            review_lag="orphan"
        fi
    fi

    # Stale sandcastle-hub ref check (only for model:hub consumers, not the
    # hub itself — the hub's internal sandcastle-hub checkout-dir references
    # in action.yml / config.ts are intentional).
    stale_ref=false
    if [[ "$model" == "hub" ]] && [[ "$role" != "hub" ]]; then
        if grep -rq "sandcastle-hub" "$repo_dir/.github/workflows/" 2>/dev/null; then
            stale_ref=true
            HARD_FAIL=$((HARD_FAIL + 1))
        fi
    fi

    # AGENT_PAT secret presence (only for model:hub consumers). Check repo
    # level first, then org level (a repo may inherit the secret from its org).
    # The secrets API requires admin on the target repo. A 403 means the token
    # cannot verify — NOT that the secret is absent. Only a 404 is a definitive
    # MISSING (and a hard failure); anything else is "unknown".
    secret=""
    if [[ "$model" == "hub" ]] && [[ "$role" != "hub" ]] && command -v gh &>/dev/null; then
        owner_repo=$(git -C "$repo_dir" remote get-url origin 2>/dev/null | sed 's|.*github.com[:/]||; s|\.git$||')
        owner="${owner_repo%%/*}"
        if [[ -n "$owner_repo" ]]; then
            repo_code=$(gh api "repos/$owner_repo/actions/secrets/AGENT_PAT" --silent -i 2>/dev/null | head -1 | awk '{print $2}' || true)
            if [[ "$repo_code" == "200" ]]; then
                secret="present"
            else
                org_code=$(gh api "orgs/$owner/actions/secrets/AGENT_PAT" --silent -i 2>/dev/null | head -1 | awk '{print $2}' || true)
                if [[ "$org_code" == "200" ]]; then
                    secret="present-org"
                elif [[ "$repo_code" == "404" ]] && [[ "$org_code" == "404" ]]; then
                    secret="MISSING"
                    HARD_FAIL=$((HARD_FAIL + 1))
                else
                    secret="unknown"
                fi
            fi
        fi
    fi

    # hub-version.json presence for model:hub consumers (not the hub itself).
    if [[ "$model" == "hub" ]] && [[ "$role" != "hub" ]] && [[ -z "$pinned" ]]; then
        HARD_FAIL=$((HARD_FAIL + 1))
    fi

    entry=$(jq \
        --arg pinned "$pinned" \
        --arg detected "$detected" \
        --arg reviewed "$reviewed" \
        --arg derived "$derived_reviewed" \
        --arg lag "$review_lag" \
        --argjson pending "$pending_pin" \
        --argjson stale "$stale_ref" \
        --arg secret "$secret" \
        '. + {pinnedSha:$pinned, detectedAt:$detected, reviewedAt:$reviewed, derivedReviewedAt:$derived, reviewLag:$lag, pendingPin:$pending, staleSandcastleHubRef:$stale, agentPat:$secret}' \
        <<<"$entry")

    REPORT_JSON=$(jq --argjson e "$entry" '.repos += [$e]' <<<"$REPORT_JSON")

    # ── Human-readable line (suppressed in --json mode) ────────────────────────
    if [[ "$JSON_ONLY" != true ]]; then
        printf "%-22s %-12s %-8s %-6s %-12s %-10s %s\n" \
            "$name" "$role" "$model" "${review_lag:-?}" "${secret:-?}" "${pinned:-none}" \
            "$( [[ "$pending_pin" == true ]] && echo "PENDING-PIN!" || echo "" )"
    fi
done < <(jq -c '.repos[]' "$MANIFEST")

# ── Write report ──────────────────────────────────────────────────────────────
mkdir -p "$(dirname "$REPORT")"
jq . <<<"$REPORT_JSON" > "$REPORT"

if [[ "$JSON_ONLY" == true ]]; then
    # Print ONLY the JSON — summary lines go to stderr so --json stays pipeable.
    cat "$REPORT"
    echo "" >&2
    echo "Report: $REPORT" >&2
    if [[ "$CHECK_ONLY" == true ]] && [[ "$HARD_FAIL" -gt 0 ]]; then
        exit 1
    fi
    exit 0
fi

echo ""
echo "Report: $REPORT"
echo "Hub latest: ${HUB_LATEST:-unknown}"
echo "Hard failures: $HARD_FAIL | Soft warnings: $SOFT_WARN"

if [[ "$CHECK_ONLY" == true ]] && [[ "$HARD_FAIL" -gt 0 ]]; then
    echo "CHECK FAILED — $HARD_FAIL hard failure(s)" >&2
    exit 1
fi
exit 0