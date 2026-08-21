# TASK

You are running the scheduled keep-tests-tight pass. Review the repository's test suite against the repo's testing principles and trim low-signal tests down to high-signal coverage.

This is an unattended CI run. There is no user to interview. Your job is to edit, combine, or delete low-signal tests so the suite stays fast, trustworthy, and high-signal.

- **Branch:** `{{BRANCH}}`

# OUT OF SCOPE — VENDORED/PRODUCER-OWNED PATHS

The following paths are **vendored or producer-owned** and are never edited from this repo:

- {{OUT_OF_SCOPE_PATHS}}

Do **NOT** modify, combine, or delete any test or file under these paths. They are re-vendored on every build; local changes would be overwritten upstream and create drift.

# TESTING PRINCIPLES

Read the repo's testing principles from `{{TESTING_PRINCIPLES}}` if the file exists, and apply them strictly.

# METHOD

1. Read `{{CONTEXT_DOC}}` and relevant ADRs under `{{ADR_DIR}}` if they exist.
2. Explore the test suite.
3. Identify low-signal tests: tiny one-assertion tests, duplicate coverage, pinned error strings, edge cases that can't happen, and tests that only assert incidental copy.
4. Edit, combine, or delete them. Keep high-signal end-user-journey tests.

# RULES

- Do **NOT** delete tests that validate real user journeys or documented business rules.
- Do **NOT** touch non-test code. Be read-only on non-test files.
- Run formatting before committing.
- Commit on `{{BRANCH}}` using conventional-commit messages (`test:`, `refactor:`).
- Do **not** push the branch. The workflow pushes and opens the PR.
- Keep your summary, removed/consolidated/kept lists, and diff stat in the session. A follow-up extraction pass will ask you to report the outcome.

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
