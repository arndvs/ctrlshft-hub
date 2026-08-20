#!/usr/bin/env bash
# test/hub-smoke-coverage.sh — Verify every hub template workflow is a clean
# thin stub that references the hub itself, and that every referenced hub
# workflow/action exists.
#
# This is the structural QA gate for the hub repo (arndvs/sandcastle-hub):
# the single source of truth for the Sandcastle engine. It ensures no stale
# vendored-model template can silently return (the drift pattern that the
# producer fixed in f075ea1). It checks:
#   1. Every agent workflow template references the hub (agent-run composite
#      or reusable-workflow call).
#   2. Every agent template avoids old-model tokens (.sandcastle/engine,
#      pnpm --ignore-workspace exec tsx ../run.ts, uses: ./.github/actions/).
#   3. Every reusable-*.yml referenced by a template exists in .github/workflows/.
#   4. The agent-run composite action exists.
#   5. engine-ci.yml exists and covers the engine.
#   6. The stale vendored sandcastle-ci.yml template is absent.
#
# Usage: bash test/hub-smoke-coverage.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASS=0
FAIL=0
FAILURES=()

_record_pass() {
    local label="$1"
    PASS=$((PASS + 1))
    printf "  \033[32m✓\033[0m %s\n" "$label"
}

_record_fail() {
    local label="$1"
    local detail="$2"
    FAIL=$((FAIL + 1))
    FAILURES+=("$label — $detail")
    printf "  \033[31m✗\033[0m %s — %s\n" "$label" "$detail"
}

echo
echo "Hub smoke coverage verification"
echo "════════════════════════════════════════════════"

# ── 1. Agent workflow templates exist and are hub-model ─────────────────────
agent_templates=()
for wf in "$ROOT"/templates/workflows/agent-*.yml; do
    [[ -f "$wf" ]] || continue
    agent_templates+=("$(basename "$wf")")
done

if [[ ${#agent_templates[@]} -ge 10 ]]; then
    _record_pass "at least 10 agent workflow templates exist (${#agent_templates[@]})"
else
    _record_fail "at least 10 agent workflow templates exist" "found ${#agent_templates[@]}"
fi

# ── 2. Every agent template references the hub (hub-model) ────────────────
hub_style_missing=()
old_model_hits=0
for wf_file in "${agent_templates[@]}"; do
    wf_path="$ROOT/templates/workflows/$wf_file"

    # Must reference the hub (agent-run composite or reusable-*.yml call).
    if grep -qE "uses: arndvs/sandcastle-hub/" "$wf_path"; then
        _record_pass "$wf_file references hub"
    else
        _record_fail "$wf_file references hub" "no uses: arndvs/sandcastle-hub/ found"
        hub_agent_missing+=("$wf_file")
    fi

    # Must avoid old-model tokens.
    old_tokens=""
    if grep -q "\.sandcastle/engine" "$wf_path"; then
        old_tokens+=" .sandcastle/engine"
    fi
    if grep -q "pnpm --ignore-workspace exec tsx" "$wf_path"; then
        old_tokens+=" pnpm tsx ../run.ts"
    fi
    if grep -q "uses: \./\.github/actions/" "$wf_path"; then
        old_tokens+=" local composite action"
    fi
    if [[ -n "$old_tokens" ]]; then
        old_model_hits=$((old_model_hits + 1))
        _record_fail "$wf_file avoids old-model tokens" "found:$old_tokens"
    else
        _record_pass "$wf_file avoids old-model tokens"
    fi
done

# ── 3. Every referenced reusable workflow exists ─────────────────────────
referenced_reusables="$(grep -hoE "reusable-[a-z-]+\.yml" "$ROOT"/templates/workflows/agent-*.yml | sort -u || true)"
if [[ -n "$referenced_reusables" ]]; then
    while read -r rwf; do
        if [[ -f "$ROOT/.github/workflows/$rwf" ]]; then
            _record_pass "reusable workflow exists: $rwf"
        else
            _record_fail "reusable workflow exists: $rwf" ".github/workflows/$rwf missing"
        fi
    done <<<"$referenced_reusables"
fi

# ── 4. Hub agent-run composite action exists ───────────────────────────
if [[ -f "$ROOT/actions/agent-run/action.yml" ]]; then
    _record_pass "agent-run composite action exists"
    if grep -q "name: Sandcastle agent run" "$ROOT/actions/agent-run/action.yml"; then
        _record_pass "agent-run action metadata present"
    else
        _record_fail "agent-run action metadata present" "missing 'name: Sandcastle agent run'"
    fi
else
    _record_fail "agent-run composite action exists" "actions/agent-run/action.yml missing"
fi

# ── 5. Engine CI present ───────────────────────────────────────────────
if [[ -f "$ROOT/.github/workflows/engine-ci.yml" ]]; then
    _record_pass "engine-ci.yml exists"
    if grep -q "engine" "$ROOT/.github/workflows/engine-ci.yml" || grep -q "test" "$ROOT/.github/workflows/engine-ci.yml"; then
        _record_pass "engine-ci.yml exercises the engine"
    else
        _record_fail "engine-ci.yml exercises the engine" "no engine/test reference found"
    fi
else
    _record_fail "engine-ci.yml exists" ".github/workflows/engine-ci.yml missing"
fi

# ── 6. Stale vendored-era template absent ──────────────────────────────
if [[ ! -f "$ROOT/templates/workflows/sandcastle-ci.yml" ]]; then
    _record_pass "stale sandcastle-ci template absent"
else
    _record_fail "stale sandcastle-ci template absent" "templates/workflows/sandcastle-ci.yml still exists"
fi

# Old-model token census across ALL templates (not just agent).
old_token_hits="$({
    grep -HE "\.sandcastle/engine|pnpm --ignore-workspace exec tsx|\/\.github/actions/" \
        "$ROOT"/templates/workflows/*.yml 2>/dev/null || true
} | wc -l | tr -d ' ')"
if [[ "$old_token_hits" == "0" ]]; then
    _record_pass "no old-model tokens in any template"
else
    _record_fail "no old-model tokens in any template" "$old_token_hits file(s) still reference the vendored model"
fi

# ── Summary ───────────────────────────────────────────────────────────────

printf "\n  \033[32m%d passed\033[0m  \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo
    echo "Failures:"
    for failure in "${FAILURES[@]}"; do
        printf "  \033[31m✗\033[0m %s\n" "$failure"
    done
    exit 1
fi