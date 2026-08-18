import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./shell-helpers.js", () => ({
  sh: vi.fn(),
  safeSh: vi.fn(),
  shFile: vi.fn(),
}));

import { sh, safeSh, shFile } from "./shell-helpers.js";
import { fetchPrComments, getOwnerRepo } from "./fetch-pr-comments.js";

const mockSh = vi.mocked(sh);
const mockSafeSh = vi.mocked(safeSh);
const mockShFile = vi.mocked(shFile);

function buildThreadsPage(
  nodes: Array<{ id: string; isResolved: boolean; isOutdated: boolean; body: string; path?: string; line?: number }>,
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage, endCursor },
            nodes: nodes.map((n) => ({
              id: n.id,
              isResolved: n.isResolved,
              isOutdated: n.isOutdated,
              comments: {
                nodes: [
                  { id: `${n.id}_c1`, path: n.path ?? "file.ts", line: n.line ?? 10, originalLine: n.line ?? 10, body: n.body, author: { login: "reviewer" } },
                ],
              },
            })),
          },
        },
      },
    },
  });
}

const PR_VIEW_JSON = JSON.stringify({
  title: "Test PR",
  body: "Fixes #42",
  headRefOid: "abc123",
  comments: [{ author: { login: "user1" }, body: "looks good", createdAt: "2026-01-01T00:00:00Z" }],
});

const REVIEWS_JSON = JSON.stringify([
  { id: 1, user: { login: "reviewer1" }, body: "LGTM", state: "APPROVED", submitted_at: "2026-01-01T00:00:00Z" },
]);

describe("getOwnerRepo", () => {
  beforeEach(() => {
    mockSh.mockReset();
  });

  it("parses owner/repo from gh output", () => {
    mockSh.mockReturnValue("arndvs/my-repo\n");
    expect(getOwnerRepo({ cwd: "/repo" })).toEqual({ owner: "arndvs", repo: "my-repo" });
  });

  it("throws on invalid format", () => {
    mockSh.mockReturnValue("invalid\n");
    expect(() => getOwnerRepo({ cwd: "/repo" })).toThrow("Cannot parse owner/repo");
  });
});

describe("fetchPrComments", () => {
  beforeEach(() => {
    mockSh.mockReset();
    mockSafeSh.mockReset();
    mockShFile.mockReset();
  });

  it("rejects invalid PR numbers", () => {
    expect(() => fetchPrComments({ prNumber: "abc", cwd: "/repo" })).toThrow("Invalid PR number");
    expect(() => fetchPrComments({ prNumber: "12;rm", cwd: "/repo" })).toThrow("Invalid PR number");
  });

  it("fetches single page of review threads", () => {
    mockSh
      .mockReturnValueOnce(PR_VIEW_JSON) // pr view
      .mockReturnValueOnce(REVIEWS_JSON) // reviews (paginated)
      .mockReturnValueOnce("arndvs/repo\n"); // owner/repo

    mockSafeSh.mockReturnValue("Fix bug\n"); // issue title

    const singlePage = buildThreadsPage(
      [{ id: "T1", isResolved: false, isOutdated: false, body: "fix this" }],
      false,
      null,
    );
    mockShFile.mockReturnValueOnce(singlePage);

    const result = fetchPrComments({ prNumber: "99", cwd: "/repo" });

    expect(result.prTitle).toBe("Test PR");
    expect(result.issueNumber).toBe("42");
    expect(result.comments.review_threads).toHaveLength(1);
    expect(result.comments.review_threads[0]!.body).toBe("fix this");
    expect(mockShFile).toHaveBeenCalledOnce();
  });

  it("paginates multiple pages of review threads", () => {
    mockSh
      .mockReturnValueOnce(PR_VIEW_JSON)
      .mockReturnValueOnce(REVIEWS_JSON)
      .mockReturnValueOnce("arndvs/repo\n");

    mockSafeSh.mockReturnValue("Fix bug\n");

    const page1 = buildThreadsPage(
      [{ id: "T1", isResolved: false, isOutdated: false, body: "page 1 comment" }],
      true,
      "cursor_abc",
    );
    const page2 = buildThreadsPage(
      [{ id: "T2", isResolved: false, isOutdated: false, body: "page 2 comment" }],
      false,
      null,
    );
    mockShFile.mockReturnValueOnce(page1).mockReturnValueOnce(page2);

    const result = fetchPrComments({ prNumber: "99", cwd: "/repo" });

    expect(result.comments.review_threads).toHaveLength(2);
    expect(result.comments.review_threads[0]!.body).toBe("page 1 comment");
    expect(result.comments.review_threads[1]!.body).toBe("page 2 comment");
    expect(mockShFile).toHaveBeenCalledTimes(2);

    // Second call should include cursor
    const secondCallArgs = mockShFile.mock.calls[1]![1] as string[];
    expect(secondCallArgs).toContain("cursor=cursor_abc");
  });

  it("filters out resolved and outdated threads", () => {
    mockSh
      .mockReturnValueOnce(PR_VIEW_JSON)
      .mockReturnValueOnce(REVIEWS_JSON)
      .mockReturnValueOnce("arndvs/repo\n");

    mockSafeSh.mockReturnValue("Fix bug\n");

    const page = buildThreadsPage([
      { id: "T1", isResolved: true, isOutdated: false, body: "resolved" },
      { id: "T2", isResolved: false, isOutdated: true, body: "outdated" },
      { id: "T3", isResolved: false, isOutdated: false, body: "active" },
    ]);
    mockShFile.mockReturnValueOnce(page);

    const result = fetchPrComments({ prNumber: "99", cwd: "/repo" });

    expect(result.comments.review_threads).toHaveLength(1);
    expect(result.comments.review_threads[0]!.body).toBe("active");
  });

  it("handles paginated REST reviews (multi-page concatenation)", () => {
    // gh api --paginate returns concatenated arrays: [...][...]
    const page1Reviews = JSON.stringify([
      { id: 1, user: { login: "r1" }, body: "Review 1", state: "CHANGES_REQUESTED", submitted_at: "2026-01-01T00:00:00Z" },
    ]);
    const page2Reviews = JSON.stringify([
      { id: 2, user: { login: "r2" }, body: "Review 2", state: "APPROVED", submitted_at: "2026-01-02T00:00:00Z" },
    ]);

    mockSh
      .mockReturnValueOnce(PR_VIEW_JSON)
      .mockReturnValueOnce(`${page1Reviews}\n${page2Reviews}`) // concatenated reviews
      .mockReturnValueOnce("arndvs/repo\n");

    mockSafeSh.mockReturnValue("Fix bug\n");

    const emptyThreads = buildThreadsPage([], false, null);
    mockShFile.mockReturnValueOnce(emptyThreads);

    const result = fetchPrComments({ prNumber: "99", cwd: "/repo" });

    expect(result.comments.review_summaries).toHaveLength(2);
    expect(result.comments.review_summaries[0]!.author).toBe("r1");
    expect(result.comments.review_summaries[1]!.author).toBe("r2");
  });
});
