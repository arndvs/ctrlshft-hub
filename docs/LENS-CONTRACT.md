# Code health audit — lens contract

The workflow calls `run.ts code-health [--lens <name>]` and reads a JSON result.
This is what the engine side must satisfy.

## The flow this fits into

```
audit (weekly)  →  files one issue per finding
                        ↓
human applies `agent:ready`      ← the only human step, and it's one click
                        ↓
implementer agent picks up the label  →  opens a PR
```

The audit never applies `agent:ready` itself. Tagging **is** the acceptance
decision — an audit that tags its own proposals is auto-merge with extra
ceremony, and puts nobody in the loop at all.

The consequence for this contract: each finding's body is read by an implementer
agent as its brief, not just by a human as a description. It has to be precise
enough to act on.

## Inputs

| Env var | Meaning |
|---|---|
| `FRICTION_CANDIDATES_FILE` | JSON of ranked candidates from `consolidate-friction.py` |
| `KNOWN_FINDINGS_FILE` | JSON of fingerprints to suppress from `collect-known-findings.sh` |
| `LENS` | Optional single lens; empty means all enabled |

`KNOWN_FINDINGS_FILE`:

```json
{
  "cooldownDays": 90,
  "cutoff": "2026-05-21T07:00:00Z",
  "open":     ["naming:src/models.py:QueryRequest"],
  "fixed":    ["structure:app/utils.py:catchall"],
  "declined": ["naming:src/api.ts:Handler"]
}
```

Read this **before** analysing and use it to steer where the agent looks — not as
a post-filter. Filtering afterwards means the budget goes on re-deriving findings
that get discarded, and a run where everything is already known costs full price
for nothing.

Suppress all three lists identically. They're separate so the reason shows up in
logs, and so `declined` can carry a longer cooldown later if 90 days proves
short.

## Output

```json
{
  "status": "proposed" | "skipped" | "error",
  "findings": [
    {
      "fingerprint": "naming:app/server/models.py:QueryRequest",
      "lens": "naming",
      "severity": "high",
      "title": "Rename QueryRequest and DataResponse to searchable names",
      "body": "markdown brief — see below",
      "allowlist": ["app/server/models.py", "app/server/api/**", "tests/**"]
    }
  ],
  "reason": "required when status is skipped or error"
}
```

**Always write this file**, including on an uncaught throw — wrap the top level
and emit `status: "error"` with the message. A step that finds no file can only
guess; one that finds a recorded error reports accurately.

## Finding body format

Because an agent implements from this, prose alone isn't enough. Each body needs:

**What's wrong and what it costs.** One or two sentences, concrete. Not "violates
naming conventions" — "grepping `Item` returns 340 hits across the repo, so
tracing a field means reading files rather than searching."

**Exact changes.** Paths, current names, proposed names. Where the change is
mechanical, list it fully; where it requires judgement, say what the judgement is
and leave it to the implementer.

**Explicit out-of-scope.** The most important line, and the one most often
missing. Without a boundary the implementer decides for itself how far the
refactor goes, and a rename becomes a restructure.

State it twice: in prose for the human reading the issue, and as a machine-
readable `allowlist` array of path globs. The implementer workflow validates its
diff against the allowlist and fails the PR on anything outside it. Prose alone
does not hold a boundary — an instruction in an issue body is the weakest tier
of enforcement available, and it works until the run where it doesn't.

A finding with no allowlist must be rejected rather than filed. An unbounded task
handed to an autonomous implementer is how a five-file cap turns into a
four-hundred-file PR.

**Verification.** Which command proves the change is safe. If nothing does, that
is itself a finding for the `verification` lens and should be filed instead.

A finding that can't be written this precisely is too vague to file. Either
sharpen it or drop it.

## Fingerprints

`<lens>:<path>:<symbol-or-slug>`

Must be stable across runs, or dedup silently stops working and the audit starts
spamming. No line numbers, no counts, no severity, no dates — those change while
the finding doesn't.

Path changes do break fingerprints, so a moved file re-proposes once. That's the
accepted failure mode; content hashing breaks on every edit instead, which is
worse.

## Lenses

Each lens is a prompt over one of the four skills, scoped narrowly enough that
findings stay comparable across runs.

| Lens | Skill | Scope |
|---|---|---|
| `naming` | `agent-navigability` | Overloaded and unsearchable identifiers, weighted by centrality |
| `structure` | `agent-navigability` | Entry points, catch-all modules, ambiguous ownership, oversized files |
| `types` | `agent-navigability` | Untyped data crossing module boundaries |
| `orientation` | `agent-navigability` | Missing or stale `AGENTS.md`, undiscoverable commands, unmarked dead paths |
| `verification` | `agent-testability` | Unverifiable paths, suites that pass while broken, flaky tests, slow fast-path |
| `logging` | `logging-audit` | Swallowed failures, untraced errors crossing boundaries, secret exposure, hot-path volume |
| `assets` | `agent-assets` | Silently failing workflows, stale assets, repeated prompts not committed |

Migration work — separating client from server, splitting a monolith — is
deliberately **not** a lens. It's repo-wide, one-time, and phased; proposing it
weekly is noise. Run navigability's migration mode by hand when you want it.

**Enable `naming` alone first.** Seven lenses on day one produces a wall of issues
against a codebase nobody has audited, which is the most likely way this gets
switched off in week two. Add `verification` second — it tends to surface the
findings that block everything else. `logging` pairs naturally with it: tests
catch known regressions, runtime output is what makes the unknown ones
diagnosable.

## Volume

`MAX_ISSUES_PER_RUN` is enforced in the workflow, but the lens should also cap
what it proposes. Roughly five, highest severity first.

**Prefer the systemic fix.** When the same problem appears at forty sites, the
finding is "naming is systematically weak in this area" with examples and a
convention proposal — not forty issues. Scheduled runs drift toward enumeration
in a way ad-hoc ones don't, so the lens prompt should say this explicitly.

## Reading the signal

`suppressedCount` is the diagnostic:

- **High suppression, no new findings** — working as intended, backlog not
  clearing. Tag more, or accept the lens is ahead of capacity.
- **Low suppression, no findings** — the lens is probably broken, not the codebase
  clean. Check the artifact logs before assuming otherwise.
- **Consistent `skipped` for weeks** — retire the lens or drop it to monthly.