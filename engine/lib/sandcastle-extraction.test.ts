import { describe, it, expect } from "vitest";
import { extractStructuredOutput, Output } from "@ai-hero/sandcastle";
import { z } from "zod";

/**
 * Regression guard for the `<output>` tag-poisoning bug.
 *
 * `@ai-hero/sandcastle`'s `findLastTagContent` historically scanned
 * left-to-right and paired the FIRST `<tag>` after a cursor with the NEXT
 * `</tag>`. When the agent's own reasoning quoted the literal `<output>` in
 * prose before emitting the real machine-parsed block — which happens reliably
 * on retry, because the retry feedback itself contains the literal `<output>`
 * string (see `buildRetryFeedback`) — the prose `<output>` opened a pair whose
 * closing `</output>` was the REAL one, and everything between them (prose +
 * the real open tag + JSON) was captured as one invalid blob. Extraction then
 * failed with `SyntaxError: Unexpected token '`'` even though valid JSON was
 * present.
 *
 * The hub pins a patched copy of the lib (see `patches/`) that scans
 * right-to-left for the last COMPLETE `<tag>...</tag>` pair, so earlier prose
 * mentions can never win. This test pins that behavior so a future lib upgrade
 * that regresses the fix fails CI.
 *
 * If this test starts failing with a "not exported" / resolution error, the
 * sandcastle lib was upgraded and changed its internal module layout — re-check
 * the patch applies to the new version before removing the guard.
 */
describe("sandcastle structured-output extraction (patched)", () => {
  const schema = z.object({
    status: z.string(),
    title: z.string(),
    candidatesConsidered: z.array(z.string()),
  });
  const output = Output.object({ tag: "output", schema });
  const context = { commits: [], branch: "feat/x" };

  it("returns the LAST complete <output> block even when prose quotes <output> first", async () => {
    const stdout = [
      'I need to understand the expected output format — like `<output>` block.',
      "<output>",
      JSON.stringify({
        status: "proposed",
        title: "Real PRD (would be wrong if selected)",
        candidatesConsidered: ["a"],
      }),
      "</output>",
      "The previous attempt failed because it emitted prose instead of a valid JSON `<output>` block.",
      "<output>",
      JSON.stringify({
        status: "proposed",
        title: "Corrected PRD (must win)",
        candidatesConsidered: ["a"],
      }),
      "</output>",
    ].join("\n");

    const result = await extractStructuredOutput<z.infer<typeof schema>>(stdout, output, context);
    expect(result.title).toBe("Corrected PRD (must win)");
  });

  it("extracts a clean single block unchanged", async () => {
    const stdout = [
      "<output>",
      "{",
      '  "status": "proposed",',
      '  "title": "Clean PRD",',
      '  "candidatesConsidered": ["a"]',
      "}",
      "</output>",
    ].join("\n");

    const result = await extractStructuredOutput<z.infer<typeof schema>>(stdout, output, context);
    expect(result.title).toBe("Clean PRD");
  });

  it("returns undefined-safe error (rawMatched) when the last open tag has no close", async () => {
    const stdout = [
      "thinking...",
      "<output>",
      '{"status":"proposed","title":"Truncated"}',
      // no </output> — simulate truncated agent output
    ].join("\n");

    await expect(extractStructuredOutput(stdout, output, context)).rejects.toThrow(
      /not found in agent output/,
    );
  });
});