# AGENTS.md — sandcastle-hub

`sandcastle-hub` is the **single source of truth** for the Sandcastle engine,
templates, actions, and labels. Consumers reference it remotely via
`uses: arndvs/sandcastle-hub/...@main`; nothing is vendored into consumers.

## Canonical invariants

Read `~/dotfiles/WORKSPACE_INVARIANTS.md` for ownership and guards.
This root is the **vendor source** — one-way copy out. See
`~/dotfiles/seams/vendor-sandcastle.md`.

## What this repo owns

- `engine/` — TypeScript engine (lib, workflows, schemas, run.ts, tests)
- `templates/workflows/` — canonical consumer stub templates (12 agent-*,
  labels-sync, sandcastle-drift) — the ONLY place stubs are defined
- `templates/prompts/`, `templates/extractions/`, `templates/scripts/`,
  `templates/labels.json`
- `actions/agent-run/` — the single composite action consumers call
- `.github/workflows/reusable-*.yml` — lifecycle workflows consumers call
- `.github/workflows/engine-ci.yml` + `test/hub-smoke-coverage.sh` (QA gate)

## What it does NOT own (never)

- Consumer `.github/workflows/agent-*.yml` — those are generated install
  artifacts; never edit them here or in consumers as source
- `ctrlshft-public/shft/templates/workflows/` — that's a MIRROR; keep in sync
  via `bin/sync-hub-templates.sh`, don't edit independently
- `claude-code-copilot`, other consumers — runtime, not product content

## Conventions

- Layout constraint: `engine/` and `templates/` MUST be siblings
  (`resolveDefaultTemplatesDir` walks `../../templates/prompts`).
- Branch flow: linear commits directly to `main` (no PR for routine engine work).
- Before merging: `bash test/hub-smoke-coverage.sh` (37/37) + `pnpm test` in `engine/`.
- After a template change: run `bash ~/dotfiles/bin/sync-hub-templates.sh` to
  mirror to the producer, then commit in the producer.

## QA gate

`test/hub-smoke-coverage.sh` asserts every workflow template references the hub
(no vendored `.sandcastle/engine` tokens), every referenced reusable exists, and
`engine-ci.yml` covers the engine. Keep it green.