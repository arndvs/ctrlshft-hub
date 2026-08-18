---
description: "Sandcastle label pipeline — the event-driven state machine, the two human gates, AGENT_PAT, and how local skills hand off to GitHub workflows. Load when editing agent-*.yml workflows, labels.json, or pipeline-adjacent skills."
applyTo: "**/.github/workflows/agent-*.yml,**/shft/templates/labels.json,**/shft/docs/triage-labels.md,**/skills/prd-to-issues/**,**/skills/review-pr-copilot/**,**/.sandcastle/**"
---
Output "Read Sandcastle Pipeline instructions." to chat to acknowledge you read this file.

# Sandcastle pipeline — the label contract

Sandcastle is an **event-driven state machine** built on GitHub issue/PR labels. Workflows
(`/.github/workflows/agent-*.yml`) trigger on `labeled`/`closed` events; each stage applies the
next label to drive the chain forward. This file is the canonical, agent-facing contract for that
label API. The exhaustive per-label reference (colors, creation) lives in `shft/docs/triage-labels.md`.

**Core rule for any automation that touches these labels:** apply labels that must trigger the next
workflow with `AGENT_PAT`, never the default `GITHUB_TOKEN` (see [AGENT_PAT](#agent_pat) below).

## The state machine

Labels live on **two objects**: the **issue** carries state up to `agent:pr-open`; the **PR** carries
the review verdict (`agent:fix` / `agent:merge` / `agent:update-branch`).

| Label | Applied by | Triggers | → Next state |
|-------|------------|----------|--------------|
| `Sandcastle` | **Human** (start gate) | `agent-review-issue.yml` | `agent:review` |
| `agent:review` | `agent-review-issue.yml` *(AGENT_PAT)* | `agent-plan-issue.yml` | `agent:implement` |
| `agent:implement` | `agent-plan-issue.yml` / `agent-promote-queued.yml` / `agent-implement-prd.yml` *(AGENT_PAT)* | `agent-implement-issue.yml` | `agent:pr-open` / `agent:implement-prd` |
| `agent:pr-open` | `agent-implement-issue.yml` | — (state marker on issue) | awaits **verdict gate** on the PR |
| `agent:fix` | **Human** (verdict gate, on PR) | `agent-fix-pr-feedback.yml` | pushes fixes → PR re-reviewed |
| `agent:merge` | **Human** (verdict gate, on PR) | `agent-merge-pr.yml` | PR merged → issue closed |
| `agent:update-branch` | **Human** (on PR) | `agent-update-branch.yml` | branch updated |
| `agent:implement-prd` | **Human** / `agent-implement-prd.yml` *(AGENT_PAT)* | `agent-implement-prd.yml` | `agent:implement-prd` (sub-issues remain) / `agent:review` (PR ready) / `agent:implement` |
| `agent:queued` | **Human** / skills | `agent-promote-queued.yml` (when a blocker closes) | `agent:implement` once deps clear |
| `agent:in-progress` | any active workflow | — (state marker) | removed on completion |
| `agent:blocked` | any workflow on failure | — | needs human intervention |
| `source:architecture-review` | `agent-architecture-review.yml` | — (proposal marker) | human triages before applying a start label |
| `repo-hygiene` | `agent-repo-hygiene.yml` | — (proposal marker) | human triages before applying a start label |
| `phase-0` | `agent-repo-hygiene.yml` | — (phase marker) | repo-hygiene phase 0 — safety net |
| `phase-1` | `agent-repo-hygiene.yml` | — (phase marker) | repo-hygiene phase 1 — structure/layout |
| `phase-2` | `agent-repo-hygiene.yml` | — (phase marker) | repo-hygiene phase 2 — DRY extraction |
| `phase-3` | `agent-repo-hygiene.yml` | — (phase marker) | repo-hygiene phase 3 — styling/typing |
| `phase-4` | `agent-repo-hygiene.yml` | — (phase marker) | repo-hygiene phase 4 — content/data |
| `phase-5` | `agent-repo-hygiene.yml` | — (phase marker) | repo-hygiene phase 5 — ratchet |
| `source:keep-tests-tight` | `agent-keep-tests-tight.yml` | — (provenance marker on PR) | human reviews the test-trim PR before merging |
| `shft` | `defer-to-issue` (engine) | — (review-metadata marker) | — |
| `hitl` | `defer-to-issue` (engine) | — (review-metadata marker) | — |

There is no separate planning-state label — `agent-plan-issue.yml` promotes
`agent:review` → `agent:implement` directly.

## The two human gates

The pipeline is autonomous **between** these gates and deliberately stops **at** them. Do not remove
them or auto-apply their labels without explicit intent.

1. **Start gate** — a human applies `Sandcastle` to an issue. This launches
   review → plan → implement → `agent:pr-open` with no further input.
2. **Verdict gate** — after `agent:pr-open`, a human reviews the PR and applies either `agent:merge`
   (ship it) or `agent:fix` (address review feedback). Nothing auto-applies these — there is **no
   auto-merge** by design.

## AGENT_PAT

Labels applied with the default `GITHUB_TOKEN` **do not trigger** other workflows (a GitHub security
constraint that prevents recursive Actions). Every label write that must chain to the next stage is
therefore applied with `GH_TOKEN="$AGENT_PAT"`. State-marker writes (`agent:in-progress`,
`agent:pr-open`, `agent:blocked`) don't *require* `AGENT_PAT` — nothing keys off them, so it doesn't
matter which token they run with (in practice the workflows reuse `AGENT_PAT || GITHUB_TOKEN`).

`AGENT_PAT` is a classic PAT with `repo` scope (private repos) or equivalent fine-grained
issue/PR/content scopes. If it is missing, the first chaining hop fails closed → the issue lands in
`agent:blocked`. There is no silent failure.

## Handoff points for skills

This is how local ctrl+shft work **enters** the pipeline. A skill running locally uses your `gh`
auth (a real PAT), so labels it applies **do** trigger workflows.

- **`prd-to-issues`** — when creating issues: apply `Sandcastle` to the first unblocked AFK issue;
  apply `agent:queued` to dependent AFK issues; apply no pipeline label to HITL issues. Encode
  blocking via **native** GitHub issue dependencies (`blockedBy`/`blocking`), **not** `Blocked by: #N`
  body text — `agent-promote-queued` reads native deps and refuses sub-issues.
- **`review-pr-copilot`** — the local-interactive equivalent of the `agent:fix` workflow
  (`agent-fix-pr-feedback.yml`). Both share the canonical scorer in
  `shft/engine/lib/score-comment.ts`. To delegate review-fixing to CI instead of doing it locally,
  apply `agent:fix` to the PR.
- **`atomic-commits` (ship)** — opens a PR; the verdict gate then applies. Do not auto-apply
  `agent:merge`.

## AFK vs HITL

An **AFK** item can be implemented and PR-opened autonomously — it does **not** mean auto-merged
(the verdict gate is always human). A **HITL** item needs human judgment before or during
implementation and gets no pipeline label until a human starts it.
