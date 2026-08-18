import { describe, it, expect } from "vitest";
import { InlineCommentSchema } from "./inline-comment.js";

describe("InlineCommentSchema", () => {
  it("parses canonical fields", () => {
    const result = InlineCommentSchema.parse({ path: "foo.ts", line: 10, body: "fix this" });
    expect(result).toEqual({ path: "foo.ts", line: 10, side: "RIGHT", body: "fix this" });
  });

  it("resolves file alias to path", () => {
    const result = InlineCommentSchema.parse({ file: "bar.ts", line: 5, body: "note" });
    expect(result.path).toBe("bar.ts");
  });

  it("resolves comment alias to body", () => {
    const result = InlineCommentSchema.parse({ path: "x.ts", line: 1, comment: "hello" });
    expect(result.body).toBe("hello");
  });

  it("extracts line from lineRange", () => {
    const result = InlineCommentSchema.parse({ path: "x.ts", lineRange: "42-50", body: "range" });
    expect(result.line).toBe(42);
  });

  it("fails when path is missing", () => {
    const result = InlineCommentSchema.safeParse({ line: 1, body: "no path" });
    expect(result.success).toBe(false);
  });

  it("fails when line is missing", () => {
    const result = InlineCommentSchema.safeParse({ path: "x.ts", body: "no line" });
    expect(result.success).toBe(false);
  });

  it("fails when body is missing", () => {
    const result = InlineCommentSchema.safeParse({ path: "x.ts", line: 1 });
    expect(result.success).toBe(false);
  });

  it("coerces string line to number", () => {
    const result = InlineCommentSchema.parse({ path: "x.ts", line: "7", body: "coerced" });
    expect(result.line).toBe(7);
  });

  it("preserves LEFT-side comments", () => {
    const result = InlineCommentSchema.parse({ path: "x.ts", line: 7, side: "LEFT", body: "removed line" });
    expect(result.side).toBe("LEFT");
  });
});
