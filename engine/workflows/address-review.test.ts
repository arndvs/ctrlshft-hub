import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies before importing the workflow
vi.mock("@ai-hero/sandcastle", () => ({
  run: vi.fn(),
  claudeCode: vi.fn(() => ({}) as never),
}));
vi.mock("@ai-hero/sandcastle/sandboxes/no-sandbox", () => ({
  noSandbox: vi.fn(() => ({}) as never),
}));
vi.mock("../lib/fetch-pr-comments.js", () => ({
  fetchPrComments: vi.fn(),
  getOwnerRepo: vi.fn(() => ({ owner: "acme", repo: "widgets" })),
}));
vi.mock("../lib/score-comment.js", () => ({
  scoreComment: vi.fn(),
}));
vi.mock("../lib/defer-to-issue.js", () => ({
  deferToIssue: vi.fn(() => ({ issueNumber: 99 })),
}));
vi.mock("../lib/resolve-threads.js", () => ({
  resolveThreads: vi.fn(),
}));
vi.mock("../lib/round-summary.js", () => ({
  postRoundSummary: vi.fn(),
}));
vi.mock("../lib/request-review.js", () => ({
  requestCopilotReview: vi.fn(),
}));
vi.mock("../lib/config.js", () => ({
  loadConfig: vi.fn(async () => ({ model: "claude-sonnet-4-20250514" })),
}));
vi.mock("../lib/resolve-prompt.js", () => ({
  resolvePrompt: vi.fn(async () => "/repo/prompts/address-review.md"),
  configPromptArgs: vi.fn(() => ({})),
  filterPromptArgs: vi.fn((_promptFile: string, args: Record<string, string>) => args),
}));
vi.mock("../lib/shell-helpers.js", () => ({
  shFile: vi.fn(() => "feat/branch"),
}));

import { runAddressReview } from "./address-review.js";
import { fetchPrComments } from "../lib/fetch-pr-comments.js";
import { scoreComment } from "../lib/score-comment.js";
import { requestCopilotReview } from "../lib/request-review.js";
import { resolveThreads } from "../lib/resolve-threads.js";
import { run } from "@ai-hero/sandcastle";

const mockFetchPrComments = vi.mocked(fetchPrComments);
const mockScoreComment = vi.mocked(scoreComment);
const mockRequestCopilotReview = vi.mocked(requestCopilotReview);
const mockResolveThreads = vi.mocked(resolveThreads);
const mockRun = vi.mocked(run);

function setupThreads(threads: Array<{ body: string; tier: "auto" | "confirm" | "hitl" }>) {
  mockFetchPrComments
    .mockReturnValueOnce({
      comments: {
        review_threads: threads.map((t, i) => ({
          path: `src/file${i}.ts`,
          line: 10,
          body: t.body,
          threadId: `thread-${i}`,
          commentId: `comment-${i}`,
        })),
      },
    } as never)
    .mockReturnValue({
      comments: { review_threads: [] },
    } as never);

  threads.forEach((t, i) => {
    mockScoreComment.mockReturnValueOnce({
      comment: { path: `src/file${i}.ts`, line: 10, body: t.body },
      score: t.tier === "auto" ? 85 : t.tier === "confirm" ? 60 : 30,
      tier: t.tier,
      signals: [],
    });
  });
}

const baseOpts = {
  prNumber: "42",
  repoDir: "/repo",
  model: "claude-sonnet-4-20250514",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("address-review round-cap guard", () => {
  it("continues rounds until unresolved comments are gone", async () => {
    mockFetchPrComments
      .mockReturnValueOnce({
        comments: {
          review_threads: [
            {
              path: "src/file0.ts",
              line: 10,
              body: "Add missing await.",
              threadId: "thread-0",
              commentId: "comment-0",
            },
          ],
        },
      } as never)
      .mockReturnValueOnce({
        comments: { review_threads: [] },
      } as never);
    mockScoreComment.mockReturnValueOnce({
      comment: { path: "src/file0.ts", line: 10, body: "Add missing await." },
      score: 100,
      tier: "auto",
      signals: [],
    });
    mockRun.mockResolvedValueOnce({ commits: [{ files: ["src/file0.ts"] }] } as never);

    const result = await runAddressReview({ ...baseOpts, round: 1, maxRounds: 3 });

    expect(mockFetchPrComments).toHaveBeenCalledTimes(2);
    expect(mockResolveThreads).toHaveBeenCalledWith({ threadIds: ["thread-0"], cwd: "/repo" });
    expect(result.roundsRun).toBe(1);
    expect(result.remaining).toBe(0);
  });

  it("throws when the starting round exceeds the max round", async () => {
    await expect(runAddressReview({ ...baseOpts, round: 4, maxRounds: 3 })).rejects.toThrow(
      "Invalid address-review round range: round (4) must be less than or equal to maxRounds (3)",
    );

    expect(mockFetchPrComments).not.toHaveBeenCalled();
    expect(mockRequestCopilotReview).not.toHaveBeenCalled();
  });

  it("does not mark comments fixed when the thread remains unresolved after the run", async () => {
    mockFetchPrComments.mockReturnValue({
      comments: {
        review_threads: [
          {
            path: "src/file0.ts",
            line: 10,
            body: "Add missing await.",
            threadId: "thread-0",
            commentId: "comment-0",
          },
        ],
      },
    } as never);
    mockScoreComment.mockReturnValue({
      comment: { path: "src/file0.ts", line: 10, body: "Add missing await." },
      score: 100,
      tier: "auto",
      signals: [],
    });
    mockRun.mockResolvedValueOnce({
      commits: [{ sha: "abc123", files: ["src/file0.ts"] }],
    } as never);

    const result = await runAddressReview({ ...baseOpts, round: 1, maxRounds: 1 });

    expect(result.fixed).toBe(0);
    expect(result.remaining).toBe(1);
    expect(mockResolveThreads).toHaveBeenCalledWith({ threadIds: ["thread-0"], cwd: "/repo" });
  });

  it("requests Copilot review when round < maxRounds", async () => {
    setupThreads([{ body: "fix typo", tier: "auto" }]);
    mockRun.mockResolvedValueOnce({ commits: [{ files: ["src/file0.ts"] }] } as never);

    await runAddressReview({ ...baseOpts, round: 1, maxRounds: 3 });

    expect(mockRequestCopilotReview).toHaveBeenCalledOnce();
  });

  it("requests Copilot review when all comments resolved (even at max round)", async () => {
    setupThreads([{ body: "fix typo", tier: "auto" }]);
    mockRun.mockResolvedValueOnce({ commits: [{ files: ["src/file0.ts"] }] } as never);

    const result = await runAddressReview({ ...baseOpts, round: 3, maxRounds: 3 });

    // All auto comments were fixed → remaining = 0 → not round-capped
    expect(result.roundCapped).toBe(false);
    expect(mockRequestCopilotReview).toHaveBeenCalledOnce();
  });

  it("skips Copilot review when round >= maxRounds with remaining comments", async () => {
    setupThreads([{ body: "redesign the API", tier: "auto" }]);
    // Simulate sandcastle failing → comments become "skipped" → remaining > 0
    mockRun.mockRejectedValueOnce(new Error("agent timed out"));

    const result = await runAddressReview({ ...baseOpts, round: 3, maxRounds: 3 });

    expect(result.roundCapped).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
    expect(mockRequestCopilotReview).not.toHaveBeenCalled();
  });

  it("returns correct counts when no threads exist", async () => {
    mockFetchPrComments.mockReturnValue({
      comments: { review_threads: [] },
    } as never);

    const result = await runAddressReview({ ...baseOpts, round: 1, maxRounds: 3 });

    expect(result).toEqual({ fixed: 0, deferred: 0, remaining: 0, roundCapped: false, roundsRun: 1 });
    expect(mockRequestCopilotReview).not.toHaveBeenCalled();
  });
});
