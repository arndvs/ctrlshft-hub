# Observation addendum for mutating agents

Append to the prompt of any agent that already reads code for another purpose —
`keep-tests-tight`, review agents, migration agents. It lets them record what
they notice without changing what they do.

The saving is real: these agents have already loaded the files. Noticing costs
almost nothing. Acting is what must stay separate.

---

## Why not just let it fix what it finds

A mutating agent given a second objective will satisfy both by the cheapest
route available, and the cheapest route is usually wrong.

The concrete case: `keep-tests-tight` optimises for a smaller suite. A
verification audit optimises for tests that catch regressions. When both run in
one agent and it finds a test asserting nothing meaningful, pruning says delete
and testability says strengthen. Deleting is cheaper, satisfies the stated goal,
and appears in the summary under `removed`. The suite gets tighter by the metric
while the weakest coverage quietly disappears — and nothing looks wrong, because
removing tests is what that workflow does.

Opposed objectives in one agent resolve toward whichever is easier to satisfy.
Keep them in separate runs.

---

## The addendum

```markdown
## Secondary: record observations, do not act on them

While doing the work above you will read code that has problems outside your
scope. Record them. Do not fix them, do not mention them in the PR body, and do
not let them influence what you change.

This matters most where the observation and your primary task disagree. If a
test is weak, that is an observation — it is not a reason to delete the test.
Your removal criteria are unchanged by anything you record here.

Append one JSON object per line to `.friction/<today>-<run-id>.jsonl`:

{"schema":1,"recorded_at":"<ISO8601>","session_ref":"<run-id>","episode":1,
 "harness":"github-actions","lens":"<lens>","signal":"<signal>",
 "disposition":"observed","fingerprint":"<lens>:<path>:<symbol>",
 "cost":{"tool_calls":0,"files_read_unused":0,"turns":0,"tokens_estimate":0},
 "statement":"<your own sentence, 40-280 chars>","confidence":"medium",
 "attribution":"pending","episode_boundary":"clear","source":"secondary-observation"}

Record these lenses only:

- `verification` — a test that passes while the behaviour it names could break;
  assertions that check a call returned rather than what it returned; a test
  whose failure output would not identify what broke; suspected flakiness.
- `logging` — an error path that discards its cause; a failure that crosses a
  module boundary without a trace; whole objects logged where a field would do;
  anything secret-shaped reaching an output stream.

Rules:

- Costs stay zero. You are not measuring friction, you are noting a defect.
  Observations are consolidated on a separate track from measured friction —
  they do not compete on cost, and they cannot displace evidence of what
  actually cost something.
- Two independent reporters are required before an observation becomes a
  finding. One workflow's opinion is not evidence, and a single agent repeating
  itself nightly is still one opinion.
- One record per distinct problem. Forty weak assertions in one file are one
  observation about that file, not forty.
- Never copy code, test names that reveal proprietary detail, log contents, or
  configuration values. Path plus your own sentence about the mechanism.
- If you record nothing, write no file. An empty file is not a clean bill of
  health and should not be mistaken for one.
```

---

## Wiring it up

The observation file is written into the workspace during the run, so it needs to
reach the store on the default branch. Two options:

**Commit it on the agent's branch.** Simplest where the workflow already opens a
PR — the observations merge with it. Downside: they only land if the PR merges,
so a declined PR loses its observations.

**Upload as an artifact, collect weekly.** The audit downloads recent artifacts
and merges them into the store before consolidating. More moving parts, but
observations survive independently of whether the primary change was accepted.

Prefer the second for agents whose PRs are frequently declined, the first
otherwise.

## Which workflows should carry this

Not all of them. Three tests, all of which must pass:

**Is it already reading the code?** The entire justification is shared reading.
An agent that must open extra files to make an observation is doing lens work,
and lens work belongs in the weekly audit where it can be ranked against
everything else.

**Does it run weekly or nightly, not per-commit?** Per-commit and per-PR
workflows swamp the store. Volume is the failure mode here, not accuracy.

**Are its objectives compatible with observing?** See below.

| Workflow shape | Add it? | Why |
|---|---|---|
| Nightly architecture review | Yes | Reads broadly, low frequency, proposes rather than mutates |
| Nightly test pruning | Yes, verification and logging only | Reads every test; opposed objective needs the observe-don't-act split |
| Weekly dependency updates | No | Reads manifests, not code |
| PR review agent | No | Per-PR frequency |
| Implementer agent | No | Reads narrowly within an allowlist; nothing general to observe |
| Release automation | No | Not reading code for comprehension |

Two or three workflows is the right number. The two-reporter threshold means one
alone produces nothing, and beyond three the marginal reporter adds duplication
rather than corroboration.

## Watch for objective drift

The instruction "do not let observations influence what you change" is a prompt
instruction — the weakest tier of enforcement available, exactly like the
out-of-scope line the allowlist replaced. There is no clean way to enforce it
here, so it has to be monitored instead.

The detection is cheap: record the primary workflow's own output rate before
adding the addendum, and compare after. If `keep-tests-tight` starts removing
noticeably more tests once it is also looking for weak assertions, the objectives
have bled and the addendum comes back off that workflow. Deleting a weak test
satisfies both goals at once, which is precisely why it is the drift to expect.