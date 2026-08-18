import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { StructuredOutputError } from "@ai-hero/sandcastle";
import { resolveWorkflow, WORKFLOW_NAMES } from "./dispatch.js";

vi.mock("./shell-helpers.js", () => ({
  outputDirPath: vi.fn(() => "/tmp"),
  shFileInherit: vi.fn(),
}));

vi.mock("../workflows/review-issue.js", () => ({
  runReviewIssue: vi.fn(),
}));

import { shFileInherit } from "./shell-helpers.js";
import { runReviewIssue } from "../workflows/review-issue.js";

const mockRunReviewIssue = vi.mocked(runReviewIssue);
const mockShFileInherit = vi.mocked(shFileInherit);
const savedGithubRepository = process.env.GITHUB_REPOSITORY;

beforeEach(() => {
  mockRunReviewIssue.mockReset();
  mockShFileInherit.mockReset();
});

afterEach(() => {
  if (savedGithubRepository === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = savedGithubRepository;
  vi.restoreAllMocks();
});

describe("resolveWorkflow", () => {
  it("returns a runner for each known workflow name", () => {
    for (const name of WORKFLOW_NAMES) {
      expect(resolveWorkflow(name)).toBeDefined();
    }
  });

  it("returns undefined for unknown workflow", () => {
    expect(resolveWorkflow("nonexistent")).toBeUndefined();
  });

  it("includes all expected workflow names", () => {
    expect(WORKFLOW_NAMES).toContain("review-issue");
    expect(WORKFLOW_NAMES).toContain("plan-issue");
    expect(WORKFLOW_NAMES).toContain("implement-issue");
    expect(WORKFLOW_NAMES).toContain("fix-pr-feedback");
    expect(WORKFLOW_NAMES).toContain("address-review");
    expect(WORKFLOW_NAMES).toContain("merge-pr");
    expect(WORKFLOW_NAMES).toContain("architecture-review");
    expect(WORKFLOW_NAMES).toContain("check-stale-prs");
    expect(WORKFLOW_NAMES).toContain("keep-tests-tight");
    expect(WORKFLOW_NAMES).toContain("repo-hygiene");
  });

  it("wraps resolved runners with StructuredOutputError diagnostics", async () => {
    const runner = resolveWorkflow("review-issue");
    expect(runner).toBeDefined();

    const error = new StructuredOutputError("bad output", {
      tag: "output",
      rawMatched: "{ nope",
      cause: new Error("invalid json"),
      commits: [],
      branch: "feat/test",
      sessionId: "sess-dispatch",
    });
    mockRunReviewIssue.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalExitCode = process.exitCode;

    try {
      await runner!({ args: { issue: "1" } as never, repoDir: "/repo", templatesDir: "/templates" });

      expect(process.exitCode).toBe(1);
      expect(consoleError).toHaveBeenCalledWith("[review-issue] Failed: malformed agent output");
      expect(consoleError).toHaveBeenCalledWith("[review-issue] Tag: <output>");
      expect(consoleError).toHaveBeenCalledWith("[review-issue] Raw matched: { nope");
    } finally {
      consoleError.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("uses a longer bounded timeout for merge-pr", async () => {
    process.env.GITHUB_REPOSITORY = "acme/widgets";
    const runner = resolveWorkflow("merge-pr");

    await runner!({ args: { pr: "42" } as never, repoDir: "/repo", templatesDir: "/templates" });

    expect(mockShFileInherit).toHaveBeenCalledWith(
      "gh",
      ["pr", "merge", "42", "--squash", "--delete-branch", "-R", "acme/widgets"],
      { cwd: "/repo", timeout: 30 * 60 * 1000 },
    );
  });
});
