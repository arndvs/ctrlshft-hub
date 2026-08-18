import { describe, it, expect, vi, beforeEach } from "vitest";
import { postReview, postThreadReply } from "./post-review.js";
import type { PrComments } from "./fetch-pr-comments.js";

vi.mock("./shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

import { shFile } from "./shell-helpers.js";

const mockShFile = vi.mocked(shFile);

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,5 @@
 import express from "express";
+import cors from "cors";
 const app = express();
+app.use(cors());
 export default app;
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,3 +10,4 @@
 export function add(a: number, b: number) {
   return a + b;
 }
+export function subtract(a: number, b: number) { return a - b; }
`;

function basePrComments(): PrComments {
  return {
    issue_comments: [],
    review_summaries: [],
    review_threads: [
      { commentId: "IC_abc", threadId: "PRRT_thread1", path: "src/app.ts", line: 2, author: "reviewer", body: "Why cors?" },
      { commentId: "IC_def", threadId: "PRRT_thread2", path: "src/utils.ts", line: 13, author: "reviewer", body: "Needs docs" },
    ],
  };
}

describe("postReview", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("posts valid comments and returns correct counts", () => {
    // diff fetch (inline comments present → fetched first)
    mockShFile.mockReturnValueOnce(SAMPLE_DIFF);
    // headSha fetch (only once a review will actually be posted)
    mockShFile.mockReturnValueOnce("abc123\n");
    // review POST
    mockShFile.mockReturnValueOnce("{}");

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [
        { path: "src/app.ts", line: 2, side: "RIGHT", body: "Good addition" },
      ],
      threadReplies: [],
      reviewBody: "LGTM",
    });

    expect(result.postedInlineComments).toBe(1);
    expect(result.droppedComments).toBe(0);
    expect(result.postedReplies).toBe(0);
    expect(result.droppedReplies).toBe(0);

    // Verify review payload
    const reviewCall = mockShFile.mock.calls[2]!;
    expect(reviewCall[1]).toContain("--input");
    const payload = JSON.parse((reviewCall[2] as { input: string }).input);
    expect(payload.commit_id).toBe("abc123");
    expect(payload.body).toBe("LGTM");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0].path).toBe("src/app.ts");
  });

  it("drops inline comments targeting files not in the diff", () => {
    mockShFile.mockReturnValueOnce("abc123\n");
    mockShFile.mockReturnValueOnce(SAMPLE_DIFF);
    mockShFile.mockReturnValueOnce("{}");

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [
        { path: "src/nonexistent.ts", line: 5, side: "RIGHT", body: "Not in diff" },
      ],
      threadReplies: [],
      reviewBody: "Review",
    });

    expect(result.postedInlineComments).toBe(0);
    expect(result.droppedComments).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("file not in diff"));
  });

  it("drops inline comments targeting lines not in diff hunks", () => {
    // diff first (inline comments present), then headSha, then review POST
    mockShFile.mockReturnValueOnce(SAMPLE_DIFF);
    mockShFile.mockReturnValueOnce("abc123\n");
    mockShFile.mockReturnValueOnce("{}");

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [
        { path: "src/app.ts", line: 999, side: "RIGHT", body: "Line out of range" },
      ],
      threadReplies: [],
      reviewBody: "Review",
    });

    expect(result.postedInlineComments).toBe(0);
    expect(result.droppedComments).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("line not in diff hunks"));
  });

  it("decodes a Buffer stderr from a failed gh pr diff into the warning detail", () => {
    // The shell helper surfaces stderr as a Buffer when the underlying process API
    // does, so decode that case rather than dropping the actionable detail.
    // must surface its text, not drop it. First call (gh pr diff) throws, then the
    // head SHA lookup and the review POST proceed.
    const err = Object.assign(new Error("Command failed"), {
      stderr: Buffer.from("gh: could not authenticate", "utf8"),
    });
    mockShFile.mockImplementationOnce(() => {
      throw err;
    });
    mockShFile.mockReturnValueOnce("abc123\n");
    mockShFile.mockReturnValueOnce("{}");

    postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [{ path: "src/app.ts", line: 2, side: "RIGHT", body: "x" }],
      threadReplies: [],
      reviewBody: "Review",
    });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("gh: could not authenticate"),
    );
  });

  it("drops thread replies referencing unknown commentIds", () => {
    mockShFile.mockReturnValueOnce("abc123\n");
    mockShFile.mockReturnValueOnce(SAMPLE_DIFF);
    mockShFile.mockReturnValueOnce("{}");

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [],
      threadReplies: [
        { commentId: "IC_unknown", body: "Stale reply" },
      ],
      reviewBody: "Review",
    });

    expect(result.postedReplies).toBe(0);
    expect(result.droppedReplies).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("not in fetched threads"));
  });

  it("posts valid thread replies via GraphQL", () => {
    // No inline comments → diff fetch skipped. headSha + review POST (reviewBody present), then reply.
    mockShFile.mockReturnValueOnce("abc123\n"); // headSha
    mockShFile.mockReturnValueOnce("{}"); // review POST
    // Thread reply POST
    mockShFile.mockReturnValueOnce("");

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [],
      threadReplies: [
        { commentId: "IC_abc", body: "Addressed" },
      ],
      reviewBody: "Review",
    });

    expect(result.postedReplies).toBe(1);
    expect(result.droppedReplies).toBe(0);

    // Verify GraphQL call
    const replyCall = mockShFile.mock.calls[2]!;
    const args = replyCall[1] as string[];
    expect(args).toContain("graphql");
    expect(args.some((a) => a.includes("PRRT_thread1"))).toBe(true);
    expect(args.some((a) => a.includes("Addressed"))).toBe(true);
    // Body must be sent as a literal raw field, never via -F/--field (magic @-file handling)
    expect(args).toContain("--raw-field");
    expect(args).not.toContain("-F");
  });

  it("skips all gh calls when skipEmptyReview is true and no comments, replies, or body", () => {
    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [],
      threadReplies: [],
      skipEmptyReview: true,
    });

    expect(result.postedInlineComments).toBe(0);
    expect(result.postedReplies).toBe(0);
    // Early return — no gh pr view / gh pr diff round-trips.
    expect(mockShFile).toHaveBeenCalledTimes(0);
  });

  it("skips all gh calls by default when no comments, replies, or body", () => {
    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [],
      threadReplies: [],
      // skipEmptyReview omitted — defaults to true
    });

    expect(result.postedInlineComments).toBe(0);
    expect(result.postedReplies).toBe(0);
    // Early return — no gh pr view / gh pr diff round-trips.
    expect(mockShFile).toHaveBeenCalledTimes(0);
  });

  it("still posts thread replies when the review is skipped (no body, no inline)", () => {
    mockShFile.mockReturnValueOnce(""); // reply POST

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [],
      threadReplies: [{ commentId: "IC_abc", body: "Addressed" }],
      skipEmptyReview: true,
    });

    expect(result.postedReplies).toBe(1);
    // Reply-only path: diff, headSha, and the review POST are all skipped — just the reply.
    expect(mockShFile).toHaveBeenCalledTimes(1);
  });

  it("posts an empty review when skipEmptyReview is explicitly false", () => {
    mockShFile.mockReturnValueOnce("abc123\n"); // headSha
    mockShFile.mockReturnValueOnce("{}"); // review POST

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [],
      threadReplies: [],
      skipEmptyReview: false,
    });

    expect(result.postedInlineComments).toBe(0);
    // No inline comments → diff fetch skipped. headSha + review POST (empty body) = 2 calls.
    expect(mockShFile).toHaveBeenCalledTimes(2);
  });

  it("handles empty diff gracefully — drops all inline comments", () => {
    // Diff fetch (first, since inline comments are present) fails
    mockShFile.mockImplementationOnce(() => { throw new Error("no diff"); });
    mockShFile.mockReturnValueOnce("abc123\n"); // headSha
    mockShFile.mockReturnValueOnce("{}"); // review POST

    const result = postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [
        { path: "src/app.ts", line: 2, side: "RIGHT", body: "Comment" },
      ],
      threadReplies: [],
      reviewBody: "Review",
    });

    expect(result.postedInlineComments).toBe(0);
    expect(result.droppedComments).toBe(1);
  });

  it("uses custom logPrefix in warnings", () => {
    mockShFile.mockReturnValueOnce("abc123\n");
    mockShFile.mockReturnValueOnce(SAMPLE_DIFF);
    mockShFile.mockReturnValueOnce("{}");

    postReview({
      prNumber: "42",
      cwd: "/repo",
      prComments: basePrComments(),
      inlineComments: [
        { path: "src/nonexistent.ts", line: 1, side: "RIGHT", body: "Bad" },
      ],
      threadReplies: [],
      reviewBody: "Review",
      logPrefix: "[my-workflow]",
    });

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[my-workflow]"));
  });
});

describe("postThreadReply", () => {
  beforeEach(() => {
    mockShFile.mockReset();
  });

  it("calls gh api graphql with the correct mutation and parameters", () => {
    mockShFile.mockReturnValueOnce("");

    postThreadReply({ threadId: "PRRT_abc123", body: "Thanks!", cwd: "/repo" });

    expect(mockShFile).toHaveBeenCalledOnce();
    const args = mockShFile.mock.calls[0]![1] as string[];
    expect(args).toContain("graphql");
    expect(args.some((a) => a.includes("PRRT_abc123"))).toBe(true);
    expect(args.some((a) => a.includes("Thanks!"))).toBe(true);
    expect(args.some((a) => a.includes("addPullRequestReviewThreadReply"))).toBe(true);
  });
});
