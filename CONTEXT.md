# ctrlshft-hub — Context

**Single source of truth for the Sandcastle agent engine.**

This repo is the hub: the one place the engine, templates, and actions live.
Consumer repos reference it remotely via `uses: arndvs/ctrlshft-hub/...@<ref>`.
Nothing is vendored into consumers; nothing drifts.

## Layout

- **`engine/`** — the TypeScript engine (lib, workflows, schemas, `run.ts`, tests). 21 test suites, 297 tests. Must sit **beside** `templates/` (sibling layout — `resolveDefaultTemplatesDir` walks `../../templates/prompts` from `engine/workflows/`).
- **`templates/`** — prompt templates, extraction templates, scripts, hooks, labels.
- **`actions/agent-run/`** — the single composite action consumers call.
- **`.github/workflows/`** — engine CI + reusable lifecycle workflows.
- **`hub/`** — release tooling (`release.sh`) + Linear provisioning.

## Producer

The engine originates in `arndvs/ctrlshft` (`shft/engine`), which is published
here. Architecture and decision records live in that repo's `docs/`
(`sandcastle-hub-architecture.md`, `ADR-008`).

## Self-dogfood

This repo runs its own architecture-review + repo-hygiene passes (see
`.github/workflows/agent-*.yml`). Engine-PRDs are filed here, where the engine
lives. The `excludedPaths` in `sandcastle.config.json` protect the hub's own
engine/templates/actions from agent proposals.
