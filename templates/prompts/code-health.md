# TASK

You are running the scheduled code-health audit. Measure the repo, run the enabled lens(es), and propose **at most five** well-scoped backlog issues for a *different* agent to execute later.

This is an unattended CI run. There is no user to interview and no HTML report to write. Your job:

1. Read the lens contract: each lens is a narrow prompt over one of the code-health skills. The lens to run is `{{LENS}}` (empty means all enabled lenses).
2. Run the audit for the enabled lens(es). For each lens, look for concrete, actionable findings — not style opinions.
3. For each finding, write a precise issue body: what's wrong and what it costs, exact changes, explicit out-of-scope, and a verification command.
4. Keep your recommendation and rationale in the session. A follow-up extraction pass will ask you to report the outcome.

The workflow will create the GitHub issues and apply the `source:code-health` and `lens:<name>` labels. Do not create issues yourself.

# FRICTION EVIDENCE

The following is ranked evidence of what this codebase actually cost, measured from real agent sessions. **Rank your findings by this evidence, not by guesswork.** A fingerprint that cost a lot outranks one that appeared often but cheaply.

```json
{{FRICTION_CANDIDATES}}
```

# KNOWN FINDINGS

These fingerprints are already filed, fixed, or declined. **Do not re-propose them.** Read this before analysing and use it to steer where you look — not as a post-filter.

```json
{{KNOWN_FINDINGS}}
```

# LENSES

Each lens is a narrow prompt over one of the code-health skills:

| Lens | Skill | Scope |
|---|---|---|
| `naming` | `agent-navigability` | Overloaded and unsearchable identifiers, weighted by centrality |
| `structure` | `agent-navigability` | Entry points, catch-all modules, ambiguous ownership, oversized files |
| `types` | `agent-navigability` | Untyped data crossing module boundaries |
| `orientation` | `agent-navigability` | Missing or stale `AGENTS.md`, undiscoverable commands, unmarked dead paths |
| `verification` | `agent-testability` | Unverifiable paths, suites that pass while broken, flaky tests, slow fast-path |
| `logging` | `logging-audit` | Swallowed failures, untraced errors crossing boundaries, secret exposure, hot-path volume |
| `assets` | `agent-assets` | Silently failing workflows, stale assets, repeated prompts not committed |

Migration work — separating client from server, splitting a monolith — is deliberately **not** a lens. It's repo-wide, one-time, and phased; proposing it weekly is noise.

# OUT OF SCOPE — VENDORED/PRODUCER-OWNED PATHS

The following paths are **vendored or producer-owned** and are managed outside the repo. Do **NOT** propose findings that touch anything under them:

- {{OUT_OF_SCOPE_PATHS}}

These paths are re-vendored on every build; findings here would be overwritten upstream. The audit must exclude them from lens scoring and finding selection.

# FINDING CONSTRUCTION RULES

- **Name the files.** "Rename the handler" is unactionable. "Rename `QueryRequest` in `src/api/models.ts` to `SearchRequest`, then update the 6 call sites listed below" is executable.
- **State the invariant.** The change must not alter behaviour. Say it every time.
- **Give the verification command.** Usually the repo's test/lint command. If nothing does, that is itself a finding for the `verification` lens.
- **Declare what's out of scope.** No styling during structural passes, no renaming, no dependency bumps, no "while I was here" fixes.
- **Assume the executing agent is competent but uninformed.** Explain which of the near-identical files is the canonical one.
- **Prefer the systemic fix.** When the same problem appears at forty sites, the finding is "naming is systematically weak in this area" with examples and a convention proposal — not forty issues.
- **Cap at five findings, highest severity first.** Volume is controlled by how much gets tagged, but an audit that opens forty issues on its first Monday makes the backlog unusable before anyone triages it.

# CONTEXT RULES

- Respect project coding standards from `{{CODING_STANDARDS}}` if the file exists.
- Read-only on the repo. No commits. No edits to source files.
- At most five issues per run. If every reasonable candidate is already covered or the repo is clean, record why no fresh proposal should be made and stop.
- No questions to a user. Make the call.
- If `{{DRY_RUN}}` is `true`, do not touch anything — only draft the findings.