# Code health lens: naming

You are auditing this repository for identifiers that cost agent time. You are
not reviewing code quality, style, or design. One axis only: **does grepping a
name return roughly the places that matter?**

Use the `agent-navigability` skill for method. This prompt narrows it to naming
and defines the output contract.

## Inputs

Findings already filed, fixed, or declined — never propose these again:

```json
{{KNOWN_FINDINGS}}
```

Friction candidates measured from real agent sessions, ranked by observed cost:

```json
{{FRICTION_CANDIDATES}}
```

**Start with the candidates.** Each is evidence that a name actually cost
something — searches that returned noise, files opened and discarded. That beats
anything you infer by reading, so work through them in rank order first and
write each up properly before looking for new problems yourself.

Candidates arrive with `attribution: pending`. Decide it: *would a competent
engineer new to this repo have hit the same wall?* If the friction was the
agent's own doing — near-duplicate searches, forgetting what it had already
read — discard the candidate and say so. Attributing agent behaviour to the
repo produces findings that fix nothing.

Only after the candidates are exhausted should you search for unmeasured naming
problems, and weight those below the measured ones.

## What counts

A name fails when searching it returns far more than the places that matter, so
an agent falls back to reading files. `Data`, `Manager`, `Handler`, `Item`,
`process`, `util`, `helper`, `Request`, `Response`, `config`, `info`.

Weight by centrality. A generic name on a core type costs on every run that
touches it. The same name on a loop variable costs nothing — do not report it.

Check the actual hit count before proposing anything. A name that sounds generic
but returns twelve relevant hits is fine, and reporting it burns credibility.

## What to exclude

- Anything lint or a type checker already catches
- Names inside a single function
- Test fixture and mock names, unless they collide with production symbols
- Vendored, generated, or third-party code
- Renames requiring a public API change — those need a migration, not an issue
- Anything in `{{KNOWN_FINDINGS}}`

## Volume

At most **five** findings. Highest cost first.

If a naming problem is systemic — the same weak convention across dozens of
symbols — that is **one** finding stating the pattern with three or four
examples and a proposed convention, not one per symbol. Scheduled audits drift
toward enumeration; resist it.

Fewer good findings beat more mediocre ones. Two is a fine result. Zero is a
fine result, and `skipped` with a reason is better than padding.

## Output

A single fenced `json` block, nothing after it:

````
```json
{
  "findings": [
    {
      "fingerprint": "naming:app/server/models.py:QueryRequest",
      "severity": "high",
      "title": "Rename QueryRequest and DataResponse to searchable names",
      "body": "<markdown brief, see below>",
      "allowlist": ["app/server/models.py", "app/server/api/**", "tests/**"]
    }
  ]
}
```
````

### The body is a brief, not a description

An implementer agent works from it once a human approves. Include, in order:

1. **Cost.** One or two concrete sentences. Not "violates naming conventions" —
   "`Item` returns 340 hits, so tracing a field means reading files rather than
   searching." Cite the measured cost when the finding came from a candidate.
2. **Exact changes.** Every current name and its replacement. If a rename needs
   judgement, say what the judgement is and leave it to the implementer.
3. **Out of scope.** What not to touch, in prose. Behaviour changes, signature
   changes to public APIs, and dependency bumps are out of scope for a rename.
4. **Verification.** The command that proves the rename is safe — usually the
   repo's test/lint command. If nothing does, that is itself a finding for the
   `verification` lens and should be filed instead.

A finding that can't be written this precisely is too vague to file. Either
sharpen it or drop it.

## Out of scope — vendored/producer-owned paths

Do **NOT** propose findings that touch anything under:

- {{OUT_OF_SCOPE_PATHS}}

These paths are re-vendored on every build; findings here would be overwritten
upstream.