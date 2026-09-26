import { describe, it, expect } from "vitest";
import { parseDiffLineAnchors } from "./parse-diff-lines.js";

// ── Fixture helpers ─────────────────────────────────────────────

function diff(...lines: string[]): string {
  return lines.join("\n");
}

// ── parseDiffLineAnchors — the production parser ────────────────
// post-review.ts relies on this: an inline comment is retained iff
// fileLines[side].has(line). These tests lock that contract.

describe("parseDiffLineAnchors", () => {
  it("returns empty map for empty diff", () => {
    expect(parseDiffLineAnchors("")).toEqual(new Map());
  });

  it("parses a single added line (RIGHT side)", () => {
    const d = diff(
      "diff --git a/foo.ts b/foo.ts",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      " line2",
      "+new line",
      " line3",
    );
    const anchors = parseDiffLineAnchors(d).get("foo.ts")!;
    // context lines 1,2,3 on both sides; added line 4 on RIGHT only
    expect(anchors.LEFT).toEqual(new Set([1, 2, 3]));
    expect(anchors.RIGHT).toEqual(new Set([1, 2, 3, 4]));
  });

  it("tracks removed lines on LEFT only", () => {
    const d = diff(
      "diff --git a/bar.ts b/bar.ts",
      "--- a/bar.ts",
      "+++ b/bar.ts",
      "@@ -1,3 +1,3 @@",
      " kept",
      "-removed",
      "+added",
      " kept2",
    );
    const anchors = parseDiffLineAnchors(d).get("bar.ts")!;
    // context 1,3 both sides; removed 2 LEFT only; added 2 RIGHT only
    expect(anchors.LEFT).toEqual(new Set([1, 2, 3]));
    expect(anchors.RIGHT).toEqual(new Set([1, 2, 3]));
  });

  it("handles multiple files", () => {
    const d = diff(
      "diff --git a/a.ts b/a.ts",
      "@@ -0,0 +1,2 @@",
      "+line1",
      "+line2",
      "diff --git a/b.ts b/b.ts",
      "@@ -0,0 +1,1 @@",
      "+only",
    );
    const anchors = parseDiffLineAnchors(d);
    expect(anchors.size).toBe(2);
    expect(anchors.get("a.ts")!.RIGHT).toEqual(new Set([1, 2]));
    expect(anchors.get("b.ts")!.RIGHT).toEqual(new Set([1]));
  });

  it("handles multiple hunks in the same file", () => {
    const d = diff(
      "diff --git a/multi.ts b/multi.ts",
      "@@ -1,3 +1,4 @@",
      " ctx",
      "+added1",
      " ctx",
      " ctx",
      "@@ -10,3 +11,4 @@",
      " ctx",
      "+added2",
      " ctx",
      " ctx",
    );
    const anchors = parseDiffLineAnchors(d).get("multi.ts")!;
    expect(anchors.RIGHT.has(2)).toBe(true); // added1
    expect(anchors.RIGHT.has(12)).toBe(true); // added2
    expect(anchors.LEFT.has(1)).toBe(true); // context in hunk 1
    expect(anchors.LEFT.has(10)).toBe(true); // context in hunk 2
  });

  it("handles hunk header with no comma in line count", () => {
    const d = diff(
      "diff --git a/single.ts b/single.ts",
      "@@ -0,0 +1 @@",
      "+only line",
    );
    const anchors = parseDiffLineAnchors(d).get("single.ts")!;
    expect(anchors.RIGHT).toEqual(new Set([1]));
    expect(anchors.LEFT).toEqual(new Set());
  });

  it("handles new-file hunks (@@ -0,0 +1,N @@)", () => {
    const d = diff(
      "diff --git a/new.ts b/new.ts",
      "@@ -0,0 +1,3 @@",
      "+a",
      "+b",
      "+c",
    );
    const anchors = parseDiffLineAnchors(d).get("new.ts")!;
    expect(anchors.LEFT).toEqual(new Set()); // no left side for new file
    expect(anchors.RIGHT).toEqual(new Set([1, 2, 3]));
  });

  it("handles deletions-only hunks (LEFT only)", () => {
    const d = diff(
      "diff --git a/del.ts b/del.ts",
      "@@ -1,3 +0,0 @@",
      "-gone1",
      "-gone2",
      "-gone3",
    );
    const anchors = parseDiffLineAnchors(d).get("del.ts")!;
    expect(anchors.LEFT).toEqual(new Set([1, 2, 3]));
    expect(anchors.RIGHT).toEqual(new Set());
  });

  it("handles \\ No newline at end of file markers", () => {
    const d = diff(
      "diff --git a/nl.ts b/nl.ts",
      "@@ -1,2 +1,2 @@",
      " kept",
      "-old",
      "+new",
      "\\ No newline at end of file",
    );
    const anchors = parseDiffLineAnchors(d).get("nl.ts")!;
    // The marker line is not a diff content line — must not corrupt anchors.
    expect(anchors.LEFT).toEqual(new Set([1, 2]));
    expect(anchors.RIGHT).toEqual(new Set([1, 2]));
  });

  it("handles rename/copy headers (path from b/ side)", () => {
    const d = diff(
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "diff --git a/other.ts b/other.ts",
      "@@ -1 +1 @@",
      "+x",
    );
    const anchors = parseDiffLineAnchors(d);
    // Rename-only entry registers the b/ path with empty anchor sets —
    // post-review drops any comment on it (no line in hunks).
    expect(anchors.get("new.ts")).toEqual({ LEFT: new Set(), RIGHT: new Set() });
    // The real hunk file is parsed.
    expect(anchors.get("other.ts")!.RIGHT).toEqual(new Set([1]));
  });

  it("skips binary diffs (no hunks to anchor)", () => {
    const d = diff(
      "diff --git a/img.png b/img.png",
      "index 0000000..1111111 100644",
      "Binary files differ",
    );
    const anchors = parseDiffLineAnchors(d);
    // Binary diff registers the file with empty anchor sets — post-review
    // drops any comment on it (no line in hunks).
    expect(anchors.get("img.png")).toEqual({ LEFT: new Set(), RIGHT: new Set() });
  });

  it("tracks LEFT and RIGHT anchors separately across offset hunks", () => {
    const d = diff(
      "diff --git a/bar.ts b/bar.ts",
      "--- a/bar.ts",
      "+++ b/bar.ts",
      "@@ -10,3 +20,3 @@",
      " kept",
      "-removed",
      "+added",
      " kept2",
    );
    const anchors = parseDiffLineAnchors(d).get("bar.ts")!;
    expect(anchors.LEFT).toEqual(new Set([10, 11, 12]));
    expect(anchors.RIGHT).toEqual(new Set([20, 21, 22]));
  });

  it("ignores non-diff lines outside hunks", () => {
    const d = diff(
      "diff --git a/a.ts b/a.ts",
      "index 0000000..1111111",
      "@@ -1 +1 @@",
      "+x",
      "some trailing text",
    );
    const anchors = parseDiffLineAnchors(d).get("a.ts")!;
    expect(anchors.RIGHT).toEqual(new Set([1]));
  });
});

// ── post-review consumer contract ───────────────────────────────
// post-review.ts keeps an inline comment iff fileLines[side].has(line).
// These tests lock that invariant so a parser regression can't silently
// drop valid review comments in production.

describe("post-review anchor contract", () => {
  it("retains a comment on an unmodified context line", () => {
    const d = diff(
      "diff --git a/ctx.ts b/ctx.ts",
      "@@ -1,3 +1,3 @@",
      " kept1",
      " kept2",
      " kept3",
    );
    const anchors = parseDiffLineAnchors(d).get("ctx.ts")!;
    // A comment on RIGHT line 2 (context) must be retained.
    expect(anchors.RIGHT.has(2)).toBe(true);
    expect(anchors.LEFT.has(2)).toBe(true);
  });

  it("drops a comment outside any hunk on a given side", () => {
    const d = diff(
      "diff --git a/ctx.ts b/ctx.ts",
      "@@ -1,3 +1,3 @@",
      " kept1",
      " kept2",
      " kept3",
    );
    const anchors = parseDiffLineAnchors(d).get("ctx.ts")!;
    // A comment on RIGHT line 99 (outside the hunk) must be dropped.
    expect(anchors.RIGHT.has(99)).toBe(false);
  });

  it("drops a comment on a removed line's RIGHT side (no right anchor)", () => {
    const d = diff(
      "diff --git a/del.ts b/del.ts",
      "@@ -1,1 +0,0 @@",
      "-gone",
    );
    const anchors = parseDiffLineAnchors(d).get("del.ts")!;
    // The removed line exists on LEFT only — a RIGHT-side comment is dropped.
    expect(anchors.LEFT.has(1)).toBe(true);
    expect(anchors.RIGHT.has(1)).toBe(false);
  });
});
