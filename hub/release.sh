#!/usr/bin/env bash
# release.sh — Create a Sandcastle hub release.
#
# The hub is the single source of truth for the Sandcastle engine. Consumers
# reference it remotely via `uses: arndvs/sandcastle-hub/...@<ref>`. A release
# tags a stable version and records the pinned SHA so consumers can:
#   - stay on @main (instant updates), or
#   - pin to a vX.Y.Z tag / SHA for stability.
#
# This replaces the old `update-sandcastle.sh` vendoring flow: instead of
# copying engine files into every consumer, we tag a version and let consumers
# point at it.
#
# Usage:
#   hub/release.sh                 # auto-bump patch (v1.2.3 -> v1.2.4)
#   hub/release.sh patch           # bump patch
#   hub/release.sh minor           # bump minor
#   hub/release.sh major           # bump major
#   hub/release.sh 1.4.0           # explicit version
#   hub/release.sh --dry-run       # show what would happen, change nothing
#
# Prints the new tag + SHA. Consumers update their .sandcastle/hub-version.json
# to pin to the printed SHA/tag.

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=false
VERSION_ARG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help)
            echo "Usage: hub/release.sh [patch|minor|major|<version>] [--dry-run]"
            echo ""
            echo "Creates a Sandcastle hub release (tags a version)."
            echo "  patch|minor|major   Bump the current version accordingly (default: patch)"
            echo "  <version>           Explicit semver, e.g. 1.4.0"
            echo "  --dry-run           Show what would happen without changing anything"
            exit 0
            ;;
        *) VERSION_ARG="$1"; shift ;;
    esac
done

# ── Determine current version ────────────────────────────────────────────────
# Prefer the latest vX.Y.Z tag; fall back to a version file.
CURRENT_VERSION=""
if command -v git >/dev/null 2>&1; then
    CURRENT_VERSION="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
fi
CURRENT_VERSION="${CURRENT_VERSION#v}"

if [[ -z "$CURRENT_VERSION" ]]; then
    # No tags yet — start at 0.1.0
    CURRENT_VERSION="0.1.0"
    echo "No existing version tag found; starting at v0.1.0." >&2
fi

# ── Compute new version ──────────────────────────────────────────────────────
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
MAJOR="${MAJOR:-0}"; MINOR="${MINOR:-0}"; PATCH="${PATCH:-0}"

case "$VERSION_ARG" in
    ""|patch) PATCH=$((PATCH + 1)) ;;
    minor)    MINOR=$((MINOR + 1)); PATCH=0 ;;
    major)    MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
    *)
        # Explicit version — validate semver-ish
        if [[ ! "$VERSION_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Invalid version: '$VERSION_ARG'. Use patch|minor|major or X.Y.Z." >&2
            exit 1
        fi
        MAJOR="${VERSION_ARG%%.*}"; REST="${VERSION_ARG#*.}"
        MINOR="${REST%%.*}"; PATCH="${REST#*.}"
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
NEW_TAG="v${NEW_VERSION}"

# ── Get current SHA ──────────────────────────────────────────────────────────
CURRENT_SHA="$(git rev-parse HEAD | cut -c1-7)"

echo "Current version: v${CURRENT_VERSION} (${CURRENT_SHA})"
echo "New version:     ${NEW_TAG}"

if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "[dry-run] Would tag ${NEW_TAG} at ${CURRENT_SHA}."
    echo "[dry-run] Consumers would pin .sandcastle/hub-version.json to:"
    echo "  { \"ref\": \"${NEW_TAG}\", \"lastPinnedSha\": \"${CURRENT_SHA}\", \"reviewedAt\": \"$(date +%F)\" }"
    exit 0
fi

# ── Verify clean tree ────────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean. Commit or stash changes before releasing." >&2
    exit 1
fi

# ── Create the tag ───────────────────────────────────────────────────────────
echo ""
echo "Tagging ${NEW_TAG} at ${CURRENT_SHA}..."
git tag -a "$NEW_TAG" -m "Sandcastle hub release ${NEW_TAG} (${CURRENT_SHA})"
git push origin "$NEW_TAG"

echo ""
echo "✅ Released ${NEW_TAG} (${CURRENT_SHA})"
echo ""
echo "Consumers can now pin to:"
echo "  { \"ref\": \"${NEW_TAG}\", \"lastPinnedSha\": \"${CURRENT_SHA}\", \"reviewedAt\": \"$(date +%F)\" }"
echo ""
echo "Or update their workflow stubs to:"
echo "  uses: arndvs/sandcastle-hub/actions/agent-run@${NEW_TAG}"
echo "  uses: arndvs/sandcastle-hub/.github/workflows/reusable-*.yml@${NEW_TAG}"