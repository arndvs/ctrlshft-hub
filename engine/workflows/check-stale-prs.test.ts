import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    appendFileSync: vi.fn(),
  };
});

import { shFile } from "../lib/shell-helpers.js";
import { runCheckStalePrs } from "./check-stale-prs.js";

const mockShFile = vi.mocked(shFile);

describe("runCheckStalePrs", () => {
  const savedRepo = process.env.GITHUB_REPOSITORY;
  const savedStaleDays = process.env.STALE_PR_DAYS;

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = "acme/widgets";
    delete process.env.STALE_PR_DAYS;
    mockShFile.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedRepo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = savedRepo;
    if (savedStaleDays === undefined) delete process.env.STALE_PR_DAYS;
    else process.env.STALE_PR_DAYS = savedStaleDays;
    vi.restoreAllMocks();
  });

  it("reports stale pull requests older than the threshold", () => {
    mockShFile.mockReturnValueOnce(JSON.stringify([
      { number: 1, title: "Old PR", updatedAt: "2026-05-30T00:00:00Z", url: "https://github.com/acme/widgets/pull/1", isDraft: false },
      { number: 2, title: "Fresh PR", updatedAt: "2026-06-14T00:00:00Z", url: "https://github.com/acme/widgets/pull/2", isDraft: true },
    ]));

    runCheckStalePrs({ repoDir: "/repo", now: new Date("2026-06-15T00:00:00Z"), staleDays: 14 });

    expect(mockShFile).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--state", "open", "--limit", "1000", "--json", "number,title,updatedAt,url,isDraft,author", "-R", "acme/widgets"],
      "/repo",
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("#1 Old PR"));
    expect(console.log).toHaveBeenCalledWith(expect.not.stringContaining("#2 Fresh PR"));
  });

  it("rejects invalid stale-day configuration", () => {
    process.env.STALE_PR_DAYS = "0";

    expect(() => runCheckStalePrs({ repoDir: "/repo" })).toThrow("STALE_PR_DAYS must be a positive integer");
  });

  it("rejects invalid stale-day overrides", () => {
    expect(() => runCheckStalePrs({ repoDir: "/repo", staleDays: 0 })).toThrow("staleDays must be a positive integer");
    expect(() => runCheckStalePrs({ repoDir: "/repo", staleDays: 1.5 })).toThrow("staleDays must be a positive integer");
  });
});
