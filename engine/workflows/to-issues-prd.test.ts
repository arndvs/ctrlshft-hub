import { describe, expect, it } from "vitest";
import { resolveBlockedByNumbers } from "./to-issues-prd.js";

describe("resolveBlockedByNumbers", () => {
  it("returns issue numbers for already-created blocker titles", () => {
    const createdIssues = new Map<string, number>([
      ["Document lifecycle", 21],
      ["Add lifecycle config", 24],
    ]);

    const result = resolveBlockedByNumbers({
      sliceTitle: "Scaffold lifecycle",
      blockedBy: ["Document lifecycle", "Add lifecycle config"],
      createdIssues,
    });

    expect(result).toEqual([21, 24]);
  });

  it("throws when a blocker title has not been created yet", () => {
    const createdIssues = new Map<string, number>([["Document lifecycle", 21]]);

    expect(() => resolveBlockedByNumbers({
      sliceTitle: "Scaffold lifecycle",
      blockedBy: ["Document lifecycle", "Missing dependency"],
      createdIssues,
    })).toThrow(
      '[to-issues-prd] Slice "Scaffold lifecycle" references blockedBy titles that have not been created yet: Missing dependency. Created titles: Document lifecycle',
    );
  });
});
