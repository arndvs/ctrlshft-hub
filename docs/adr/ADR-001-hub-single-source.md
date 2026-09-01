# ADR-001 — ctrlshft-hub is the single source of truth for the engine

**Status:** Accepted
**Date:** 2026-08-18
**Author:** Aaron Davis

## Context

The Sandcastle agent engine was previously vendored into every consumer repo
(~101 files each), causing drift, weekly re-vendor churn, and nightly agents
proposing edits to engine copies. The fix is a hub repo that is the single
source of truth, with consumers referencing it remotely.

## Decision

This repo (`arndvs/ctrlshft-hub`) is the sole home of the Sandcastle engine,
templates, actions, and labels. Consumers keep only `sandcastle.config.json` +
thin workflow stubs + a `hub-version.json` SHA-lock, and reference the hub via
`uses: arndvs/ctrlshft-hub/...@<ref>`.

The engine layout constraint: `engine/` and `templates/` MUST be siblings
(`resolveDefaultTemplatesDir` walks `../../templates/prompts` from
`engine/workflows/`).

## Consequences

- Zero drift by construction (no vendored copies).
- Single runtime truth (all consumers run the same engine version).
- The producer (ctrlshft) and this hub both dogfood the model.
- Engine-PRDs are filed here, where the engine lives.

See `arndvs/ctrlshft` `docs/adr/ADR-008-sandcastle-hub.md` for the full
decision record.
