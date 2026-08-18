import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

vi.mock("../lib/run-with-extraction.js", () => ({
  runWithExtraction: vi.fn(),
}));

vi.mock("../lib/config.js", () => ({
  loadConfig: vi.fn(async () => ({
    model: "test-model",
    baseBranch: "main",
    sandbox: "none",
    promptDir: ".sandcastle/prompts",
    codingStandards: ".sandcastle/CODING_STANDARDS.md",
    contextDoc: "CONTEXT.md",
    adrDir: "docs/adr",
    packageManager: "pnpm",
  })),
}));

vi.mock("../lib/resolve-prompt.js", () => ({
  resolvePrompt: vi.fn(async () => "/templates/prompts/keep-tests-tight.md"),
  configPromptArgs: vi.fn(() => ({})),
  filterPromptArgs: vi.fn((_file, args) => args),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn((p: string) =>
      String(p).includes("extractions") ? "<output></output>" : actual.readFileSync(p, "utf8"),
    ),
  };
});

import { shFile } from "../lib/shell-helpers.js";
import { runWithExtraction } from "../lib/run-with-extraction.js";
import { runKeepTestsTight, hasRecentCommits } from "./keep-tests-tight.js";

const mockShFile = vi.mocked(shFile);
const mockRunWithExtraction = vi.mocked(runWithExtraction);

describe("hasRecentCommits", () => {
  beforeEach(() => {
    mockShFile.mockReset();
  });

  it("returns true when git log has output", () => {
    mockShFile.mockReturnValueOnce("abc1234 fix: something\n");
    expect(hasRecentCommits("/repo")).toBe(true);
    expect(mockShFile).toHaveBeenCalledWith("git", ["log", "--since=24 hours", "--oneline"], "/repo");
  });

  it("returns false when git log is empty", () => {
    mockShFile.mockReturnValueOnce("");
    expect(hasRecentCommits("/repo")).toBe(false);
  });
});

describe("runKeepTestsTight", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    mockRunWithExtraction.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no-changes without invoking the agent when there are no recent commits", async () => {
    mockShFile.mockReturnValueOnce("");

    const result = await runKeepTestsTight({ repoDir: "/repo", branch: "agent/keep-tests-tight-2026-08-05" });

    expect(result).toEqual({ status: "no-changes", reason: "no commits in last 24 hours" });
    expect(mockRunWithExtraction).not.toHaveBeenCalled();
  });

  it("invokes the agent and returns its output when there are recent commits", async () => {
    mockShFile.mockReturnValueOnce("abc1234 fix: something\n");
    mockRunWithExtraction.mockResolvedValueOnce({
      output: {
        status: "changed",
        summary: "Trimmed low-signal tests",
        removed: ["test/a.test.ts"],
        consolidated: ["test/b.test.ts"],
        kept: ["test/journey.test.ts"],
        diffStat: "10 files changed, 120 insertions(+), 300 deletions(-)",
      },
    } as never);

    const result = await runKeepTestsTight({ repoDir: "/repo", branch: "agent/keep-tests-tight-2026-08-05" });

    expect(result).toEqual({
      status: "changed",
      summary: "Trimmed low-signal tests",
      removed: ["test/a.test.ts"],
      consolidated: ["test/b.test.ts"],
      kept: ["test/journey.test.ts"],
      diffStat: "10 files changed, 120 insertions(+), 300 deletions(-)",
    });
    expect(mockRunWithExtraction).toHaveBeenCalledTimes(1);
  });
});
