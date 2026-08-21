# TASK

You are running the scheduled architecture-review pass. Find one fresh deepening opportunity in this codebase and draft it as a PRD.

This is an unattended CI run. There is no user to interview and no HTML report to write. Your job is:

1. List prior proposals labelled `source:architecture-review` (open and closed) so you do not re-propose them.
2. Read `{{CONTEXT_DOC}}` and relevant ADRs under `{{ADR_DIR}}`.
3. Explore the codebase.
4. Pick **one** top candidate.
5. Draft a PRD issue title and body.
6. Keep your final recommendation, candidate notes, and skip rationale in the session. A follow-up extraction pass will ask you to report the outcome.

The workflow will create the GitHub issue and apply the `source:architecture-review` label. Do not create the issue yourself.

# OUT OF SCOPE — VENDORED/PRODUCER-OWNED CODE

The following paths are **vendored or producer-owned** and are managed exclusively in the property's source repo. Do **NOT** propose, plan, or reference changes to anything under them:

- {{OUT_OF_SCOPE_PATHS}}

These files are re-vendored on every sync; proposals to change them here would diverge from the single source of truth and be overwritten. Focus candidates exclusively on the repo's own application code.

# REVIEW METHOD

Look for architectural deepening opportunities rather than cosmetic cleanup:

- Modules where deletion would be hard because responsibilities are tangled.
- Concepts that appear in several places without a single named abstraction.
- Workflows where state transitions are implicit or duplicated.
- Boundaries where tests, docs, or types do not protect the intended design.
- Existing patterns that could be made smaller by removing indirection.

Prefer one proposal that would make future changes easier to reason about. Do not propose work already covered by a prior `source:architecture-review` issue, even if the wording differs.

# CONTEXT RULES

- Treat ADRs as binding. Do not propose changes that contradict a recorded decision.
- Respect project coding standards from `{{CODING_STANDARDS}}` if the file exists.
- Read-only on the repo. No commits. No edits to `{{CONTEXT_DOC}}`, ADRs, or source files.

# SECONDARY: RECORD OBSERVATIONS, DO NOT ACT ON THEM

While doing the work above you will read code that has problems outside your scope. Record them. Do not fix them, do not mention them in the PR body, and do not let them influence what you change.

This matters most where the observation and your primary task disagree. If a test is weak, that is an observation — it is not a reason to delete the test. Your removal criteria are unchanged by anything you record here.

Append one JSON object per line to `.friction/<today>-<run-id>.jsonl`:

```json
{"schema":1,"recorded_at":"<ISO8601>","session_ref":"<run-id>","episode":1,"harness":"github-actions","lens":"<lens>","signal":"<signal>","disposition":"observed","fingerprint":"<lens>:<path>:<symbol>","cost":{"tool_calls":0,"files_read_unused":0,"turns":0,"tokens_estimate":0},"statement":"<your own sentence, 40-280 chars>","confidence":"medium","attribution":"pending","episode_boundary":"clear","source":"secondary-observation"}
```

Record these lenses only:

- `verification` — a test that passes while the behaviour it names could break; assertions that check a call returned rather than what it returned; a test whose failure output would not identify what broke; suspected flakiness.
- `logging` — an error path that discards its cause; a failure that crosses a module boundary without a trace; whole objects logged where a field would do; anything secret-shaped reaching an output stream.

Rules:

- Costs stay zero. You are not measuring friction, you are noting a defect. Observations are consolidated on a separate track from measured friction — they do not compete on cost, and they cannot displace evidence of what actually cost something.
- Two independent reporters are required before an observation becomes a finding. One workflow's opinion is not evidence, and a single agent repeating itself nightly is still one opinion.
- One record per distinct problem. Forty weak assertions in one file are one observation about that file, not forty.
- Never copy code, test names that reveal proprietary detail, log contents, or configuration values. Path plus your own sentence about the mechanism.
- If you record nothing, write no file. An empty file is not a clean bill of health and should not be mistaken for one.
- One PRD per run. If every reasonable candidate is already covered, record why no fresh proposal should be made and stop.
- No questions to a user. Make the call.
