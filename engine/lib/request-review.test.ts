import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestCopilotReview } from "./request-review.js";

vi.mock("./shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

import { shFile } from "./shell-helpers.js";

const mockShFile = vi.mocked(shFile);

const baseOpts = { owner: "acme", repo: "widgets", prNumber: "42", cwd: "/repo" };

describe("requestCopilotReview", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("requests review from copilot via gh pr edit", () => {
    mockShFile.mockReturnValueOnce("false"); // draft check
    mockShFile.mockReturnValueOnce(""); // review request

    requestCopilotReview(baseOpts);

    expect(mockShFile).toHaveBeenCalledTimes(2);
    const reviewCall = mockShFile.mock.calls[1]!;
    // Must go through `gh pr edit --add-reviewer` (GraphQL); the REST
    // reviewers[] endpoint 422s the Copilot app and silently no-ops. Assert the
    // full argv including the explicit --repo + PR number (the reason
    // owner/repo/prNumber are passed) so it never silently relies on ambient cwd
    // or drops the targeting.
    expect(reviewCall[1]).toEqual([
      "pr", "edit", "42", "--repo", "acme/widgets", "--add-reviewer", "copilot-pull-request-reviewer",
    ]);
    expect(reviewCall[1]).not.toContain("requested_reviewers");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Requested Copilot review"));
  });

  it("skips when PR is a draft", () => {
    mockShFile.mockReturnValueOnce("true"); // draft check

    requestCopilotReview(baseOpts);

    expect(mockShFile).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("draft"));
  });

  it("warns when copilot is not available as reviewer", () => {
    mockShFile.mockReturnValueOnce("false"); // draft check
    mockShFile.mockImplementationOnce(() => {
      throw new Error("422 Reviews may only be requested from collaborators");
    });

    requestCopilotReview(baseOpts);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("not available as reviewer"));
  });

  it("warns on generic API error without crashing", () => {
    mockShFile.mockReturnValueOnce("false"); // draft check
    mockShFile.mockImplementationOnce(() => {
      throw new Error("500 Internal Server Error");
    });

    requestCopilotReview(baseOpts);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to request"));
  });

  it("continues with review request when draft check fails", () => {
    mockShFile.mockImplementationOnce(() => {
      throw new Error("network error");
    });
    mockShFile.mockReturnValueOnce(""); // review request succeeds

    requestCopilotReview(baseOpts);

    expect(mockShFile).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Requested Copilot review"));
  });
});
