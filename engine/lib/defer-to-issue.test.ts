import { describe, it, expect, vi, beforeEach } from "vitest";
import { deferToIssue } from "./defer-to-issue.js";
import type { ScoredComment } from "./types.js";

vi.mock("./shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

vi.mock("./resolve-threads.js", () => ({
  resolveThread: vi.fn(),
}));

import { shFile } from "./shell-helpers.js";
import { resolveThread } from "./resolve-threads.js";

const mockShFile = vi.mocked(shFile);
const mockResolveThread = vi.mocked(resolveThread);

const basePr = { prNumber: "42", owner: "acme", repo: "widgets", cwd: "/repo" };

function makeScoredComment(overrides?: Partial<ScoredComment>): ScoredComment {
  return {
    comment: { path: "src/utils.ts", line: 10, body: "Consider restructuring this module for better separation of concerns" },
    score: 30,
    tier: "hitl",
    signals: [
      { label: "vague language", delta: -25 },
      { label: "cross-file", delta: -15 },
    ],
    ...overrides,
  };
}

/** Label list response where both shft and hitl labels exist. */
const LABELS_WITH_BOTH = JSON.stringify([{ name: "shft" }, { name: "hitl" }, { name: "Sandcastle" }]);

/** Label list response where neither shft nor hitl labels exist. */
const LABELS_WITHOUT = JSON.stringify([{ name: "Sandcastle" }]);

describe("deferToIssue", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    mockResolveThread.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("creates a GitHub issue with correct title, body, and labels", () => {
    // First call: label list (shft/hitl present)
    // Second call: findExistingIssue returns empty array
    // Third call: issue create returns new issue
    // Fourth call: postThreadReply
    mockShFile
      .mockReturnValueOnce(LABELS_WITH_BOTH)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockReturnValueOnce("");

    const result = deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" });

    expect(result.issueNumber).toBe(99);

    // Verify issue creation call
    const createCall = mockShFile.mock.calls[2]!;
    expect(createCall[1]).toContain("--label");
    expect(createCall[1]).toContain("shft");
    expect(createCall[1]).toContain("hitl");
  });

  it("resolves the thread after creating the issue", () => {
    mockShFile
      .mockReturnValueOnce(LABELS_WITH_BOTH)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockReturnValueOnce("");

    deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" });

    expect(mockResolveThread).toHaveBeenCalledWith({ threadId: "PRRT_abc", cwd: "/repo" });
  });

  it("skips issue creation when duplicate exists", () => {
    const scored = makeScoredComment({ comment: { path: "src/utils.ts", line: 10, body: "Short comment" } });
    const expectedTitle = "review: Short comment";

    mockShFile
      .mockReturnValueOnce(LABELS_WITH_BOTH)
      .mockReturnValueOnce(JSON.stringify([{ number: 50, url: "https://github.com/acme/widgets/issues/50", title: expectedTitle }]));
    // Thread reply call
    mockShFile.mockReturnValueOnce("");

    const result = deferToIssue({ scored, pr: basePr, threadId: "PRRT_dup", cwd: "/repo" });

    expect(result.issueNumber).toBe(50);
    // Should NOT have called issue create (only labelList + findExisting + threadReply)
    expect(mockShFile).toHaveBeenCalledTimes(3);
  });

  it("includes score breakdown in issue body", () => {
    mockShFile
      .mockReturnValueOnce(LABELS_WITH_BOTH)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockReturnValueOnce("");

    deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" });

    const createCall = mockShFile.mock.calls[2]!;
    const bodyArg = (createCall[1] as string[])[(createCall[1] as string[]).indexOf("--body") + 1]!;
    expect(bodyArg).toContain("30/100");
    expect(bodyArg).toContain("vague language: -25");
    expect(bodyArg).toContain("`src/utils.ts`");
  });

  it("posts a thread reply linking to the created issue", () => {
    mockShFile
      .mockReturnValueOnce(LABELS_WITH_BOTH)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockReturnValueOnce("");

    deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" });

    // Fourth call is the thread reply
    const replyCall = mockShFile.mock.calls[3]!;
    const args = replyCall[1] as string[];
    expect(args.some((a) => a.includes("Deferred to #99"))).toBe(true);
  });

  it("does not resolve the thread when posting the backlink fails", () => {
    mockShFile
      .mockReturnValueOnce(LABELS_WITH_BOTH)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockImplementationOnce(() => {
        throw new Error("graphql failed");
      });

    expect(() => deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" })).toThrow("graphql failed");
    expect(mockResolveThread).not.toHaveBeenCalled();
  });

  it("omits --label flags from issue create when shft/hitl labels do not exist", () => {
    mockShFile
      .mockReturnValueOnce(LABELS_WITHOUT)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockReturnValueOnce("");

    const result = deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" });

    expect(result.issueNumber).toBe(99);
    const createCall = mockShFile.mock.calls[2]!;
    expect(createCall[1]).not.toContain("--label");
    expect(createCall[1]).not.toContain("shft");
    expect(createCall[1]).not.toContain("hitl");
  });

  it("omits the label filter from the dedup search when shft/hitl labels do not exist", () => {
    mockShFile
      .mockReturnValueOnce(LABELS_WITHOUT)
      .mockReturnValueOnce(JSON.stringify([]))
      .mockReturnValueOnce("https://github.com/acme/widgets/issues/99\n")
      .mockReturnValueOnce("");

    deferToIssue({ scored: makeScoredComment(), pr: basePr, threadId: "PRRT_abc", cwd: "/repo" });

    // Dedup (issue list) is the second call
    const listCall = mockShFile.mock.calls[1]!;
    expect(listCall[0]).toBe("gh");
    expect(listCall[1]).toContain("issue");
    expect(listCall[1]).toContain("list");
    expect(listCall[1]).not.toContain("--label");
  });
});
