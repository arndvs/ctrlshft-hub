import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

import { shFile } from "../lib/shell-helpers.js";
import { publishFindings, type CodeHealthFinding } from "./code-health.js";

const mockShFile = vi.mocked(shFile);

const finding: CodeHealthFinding = {
  fingerprint: "naming:src/api.ts:QueryRequest",
  lens: "naming",
  severity: "high",
  title: "Rename QueryRequest to SearchRequest",
  body: "The issue body.",
  allowlist: ["src/api.ts", "src/api/**", "tests/**"],
};

beforeEach(() => {
  mockShFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("publishFindings", () => {
  it("creates one issue per finding with source + lens labels", () => {
    mockShFile.mockReturnValue("https://github.com/acme/widgets/issues/42\n");

    const published = publishFindings({
      findings: [finding],
      repoDir: "/repo",
      repo: "acme/widgets",
    });

    expect(mockShFile).toHaveBeenCalledWith(
      "gh",
      [
        "issue", "create",
        "--repo", "acme/widgets",
        "--title", "Rename QueryRequest to SearchRequest",
        "--body", expect.stringContaining("code-health-fingerprints"),
        "--label", "source:code-health",
        "--label", "lens:naming",
      ],
      "/repo",
    );
    expect(published).toHaveLength(1);
    expect(published[0]!.issueNumber).toBe(42);
    expect(published[0]!.issueUrl).toBe("https://github.com/acme/widgets/issues/42");
  });

  it("embeds the fingerprint and allowlist as HTML comments in the body", () => {
    mockShFile.mockReturnValue("https://github.com/acme/widgets/issues/7\n");

    publishFindings({ findings: [finding], repoDir: "/repo", repo: "acme/widgets" });

    const args = mockShFile.mock.calls[0]![1]!;
    const bodyIndex = args.indexOf("--body");
    const bodyValue = args[bodyIndex + 1]!;

    expect(bodyValue).toContain("<!-- code-health-fingerprints\nnaming:src/api.ts:QueryRequest\n-->");
    expect(bodyValue).toContain("<!-- code-health-allowlist\nsrc/api.ts\nsrc/api/**\ntests/**\n-->");
    expect(bodyValue).toContain("Apply `agent:ready` to hand this to an implementer agent.");
  });

  it("throws when gh issue create output has no issue number", () => {
    mockShFile.mockReturnValue("unexpected output\n");

    expect(() =>
      publishFindings({ findings: [finding], repoDir: "/repo", repo: "acme/widgets" }),
    ).toThrow(/Failed to parse issue number/);
  });
});