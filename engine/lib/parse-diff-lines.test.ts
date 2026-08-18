import { describe, it, expect } from "vitest";
import { parseDiffLineAnchors, parseDiffLines } from "./parse-diff-lines.js";

describe("parseDiffLines", () => {
  it("returns empty map for empty diff", () => {
    expect(parseDiffLines("")).toEqual(new Map());
  });

  it("parses a single added line", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      " line2",
      "+new line",
      " line3",
    ].join("\n");

    const result = parseDiffLines(diff);
    expect(result.get("foo.ts")).toEqual(new Set([1, 2, 3, 4]));
  });

  it("tracks only added lines in the right side", () => {
    const diff = [
      "diff --git a/bar.ts b/bar.ts",
      "--- a/bar.ts",
      "+++ b/bar.ts",
      "@@ -1,3 +1,3 @@",
      " kept",
      "-removed",
      "+added",
      " kept2",
    ].join("\n");

    const result = parseDiffLines(diff);
    const lines = result.get("bar.ts")!;
    // context lines 1, 3 and added line 2
    expect(lines.has(1)).toBe(true);
    expect(lines.has(2)).toBe(true);
    expect(lines.has(3)).toBe(true);
  });

  it("handles multiple files", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "@@ -0,0 +1,2 @@",
      "+line1",
      "+line2",
      "diff --git a/b.ts b/b.ts",
      "@@ -0,0 +1,1 @@",
      "+only",
    ].join("\n");

    const result = parseDiffLines(diff);
    expect(result.size).toBe(2);
    expect(result.get("a.ts")).toEqual(new Set([1, 2]));
    expect(result.get("b.ts")).toEqual(new Set([1]));
  });

  it("handles multiple hunks in the same file", () => {
    const diff = [
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
    ].join("\n");

    const result = parseDiffLines(diff);
    const lines = result.get("multi.ts")!;
    expect(lines.has(2)).toBe(true); // added1
    expect(lines.has(12)).toBe(true); // added2
  });

  it("handles hunk header with no comma in line count", () => {
    const diff = [
      "diff --git a/single.ts b/single.ts",
      "@@ -0,0 +1 @@",
      "+only line",
    ].join("\n");

    const result = parseDiffLines(diff);
    expect(result.get("single.ts")).toEqual(new Set([1]));
  });

  it("tracks LEFT and RIGHT anchors separately", () => {
    const diff = [
      "diff --git a/bar.ts b/bar.ts",
      "--- a/bar.ts",
      "+++ b/bar.ts",
      "@@ -10,3 +20,3 @@",
      " kept",
      "-removed",
      "+added",
      " kept2",
    ].join("\n");

    const result = parseDiffLineAnchors(diff).get("bar.ts")!;

    expect(result.LEFT).toEqual(new Set([10, 11, 12]));
    expect(result.RIGHT).toEqual(new Set([20, 21, 22]));
  });
});
