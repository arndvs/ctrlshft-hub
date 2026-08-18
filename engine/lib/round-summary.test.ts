import { describe, it, expect, vi, beforeEach } from "vitest";
import { postRoundSummary } from "./round-summary.js";

vi.mock("./shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

import { shFile } from "./shell-helpers.js";

const mockShFile = vi.mocked(shFile);

const baseOpts = {
  owner: "acme",
  repo: "widgets",
  prNumber: "42",
  round: 1,
  maxRounds: 3,
  cwd: "/repo",
};

describe("postRoundSummary", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("posts a comment with round number and results table", () => {
    mockShFile.mockReturnValueOnce("");

    postRoundSummary({
      ...baseOpts,
      results: [
        { body: "Add missing await", score: 85, tier: "auto", action: "fixed" },
        { body: "Restructure the module", score: 30, tier: "hitl", action: "deferred", issueNumber: 99 },
      ],
    });

    const args = mockShFile.mock.calls[0]![1] as string[];
    const bodyIdx = args.indexOf("--body") + 1;
    const body = args[bodyIdx]!;

    expect(body).toContain("Round 1/3");
    expect(body).toContain("Add missing await");
    expect(body).toContain("Fixed ✅");
    expect(body).toContain("Deferred → #99");
    expect(body).toContain("**1** fixed");
    expect(body).toContain("**1** deferred");
  });

  it("includes round cap warning when at max rounds with skipped comments", () => {
    mockShFile.mockReturnValueOnce("");

    postRoundSummary({
      ...baseOpts,
      round: 3,
      maxRounds: 3,
      results: [{ body: "Complex refactor needed", score: 55, tier: "confirm", action: "skipped" }],
    });

    const args = mockShFile.mock.calls[0]![1] as string[];
    const body = args[(args as string[]).indexOf("--body") + 1]!;
    expect(body).toContain("Round cap reached");
    expect(body).toContain("1 unresolved comment(s)");
  });

  it("does not show round cap warning before max rounds", () => {
    mockShFile.mockReturnValueOnce("");

    postRoundSummary({
      ...baseOpts,
      round: 1,
      maxRounds: 3,
      results: [{ body: "Something skipped", score: 55, tier: "confirm", action: "skipped" }],
    });

    const args = mockShFile.mock.calls[0]![1] as string[];
    const body = args[(args as string[]).indexOf("--body") + 1]!;
    expect(body).not.toContain("Round cap reached");
  });

  it("warns on API error without crashing", () => {
    mockShFile.mockImplementationOnce(() => {
      throw new Error("network error");
    });

    postRoundSummary({ ...baseOpts, results: [] });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to post round summary"));
  });
});
