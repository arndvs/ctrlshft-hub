# EMIT STRUCTURED OUTPUT

You have finished the code-health pass. **Do not explore further or make any changes** — only report the outcome.

End your response with a single `<output>` block. It has one of three shapes.

## Proposed findings this run

<output>
{
  "status": "proposed",
  "findings": [
    {
      "fingerprint": "naming:src/api/models.ts:QueryRequest",
      "lens": "naming",
      "severity": "high",
      "title": "Rename QueryRequest to SearchRequest",
      "body": "The issue body you drafted.",
      "allowlist": ["src/api/models.ts", "src/api/**", "tests/**"]
    }
  ]
}
</output>

## Skipped — nothing to propose

<output>
{
  "status": "skipped",
  "reason": "Why no findings were proposed (e.g. a finding is already open, or the repo is clean)."
}
</output>

## Error — the audit could not complete

<output>
{
  "status": "error",
  "reason": "What went wrong."
}
</output>

Field rules:

- `status` — `"proposed"`, `"skipped"`, or `"error"`. Required.
- `findings` — required when proposed; array of 1–5 finding objects.
- Each finding requires: `fingerprint` (`<lens>:<path>:<symbol-or-slug>`, stable across runs — no line numbers, no counts, no severity, no dates), `lens`, `severity` (`high`/`medium`/`low`), `title` (≤256 chars), `body` (the full issue body), and `allowlist` (non-empty array of path globs the implementer is permitted to modify).
- `reason` — required when skipped or error.

Do not add fields beyond those listed. The JSON is machine-parsed.