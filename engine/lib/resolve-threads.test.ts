import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveThread, resolveThreads } from "./resolve-threads.js";

vi.mock("./shell-helpers.js", () => ({
  shFile: vi.fn(),
}));

import { shFile } from "./shell-helpers.js";

const mockShFile = vi.mocked(shFile);

describe("resolveThread", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("calls gh api graphql with the correct mutation", () => {
    mockShFile.mockReturnValue("");

    resolveThread({ threadId: "PRRT_abc123", cwd: "/repo" });

    expect(mockShFile).toHaveBeenCalledOnce();
    const args = mockShFile.mock.calls[0]!;
    expect(args[0]).toBe("gh");
    expect(args[1]).toContain("graphql");
    expect(args[1]).toContain("threadId=PRRT_abc123");
  });

  it("throws on invalid thread ID prefix", () => {
    expect(() => resolveThread({ threadId: "IC_bad", cwd: "/repo" })).toThrow("expected PRRT_ prefix");
  });

  it("skips already-resolved threads without throwing", () => {
    mockShFile.mockImplementation(() => {
      throw new Error("already resolved");
    });

    resolveThread({ threadId: "PRRT_resolved", cwd: "/repo" });

    expect(mockShFile).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("already resolved"));
  });

  it("skips on permission denied without throwing", () => {
    mockShFile.mockImplementation(() => {
      throw new Error("Resource not accessible by integration");
    });

    resolveThread({ threadId: "PRRT_noperm", cwd: "/repo" });

    expect(mockShFile).toHaveBeenCalledOnce();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  });

  it("retries once on transient error then gives up", () => {
    mockShFile.mockImplementation(() => {
      throw new Error("network timeout");
    });

    resolveThread({ threadId: "PRRT_flaky", cwd: "/repo" });

    expect(mockShFile).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("after 2 attempts"));
  });

  it("succeeds on retry after first failure", () => {
    let calls = 0;
    mockShFile.mockImplementation(() => {
      calls++;
      if (calls === 1) throw new Error("network timeout");
      return "";
    });

    resolveThread({ threadId: "PRRT_retry", cwd: "/repo" });

    expect(mockShFile).toHaveBeenCalledTimes(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Resolved thread"));
  });
});

describe("resolveThreads", () => {
  beforeEach(() => {
    mockShFile.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("resolves multiple threads independently", () => {
    let callCount = 0;
    mockShFile.mockImplementation(() => {
      callCount++;
      if (callCount === 1) throw new Error("network timeout");
      if (callCount === 2) throw new Error("network timeout");
      return "";
    });

    resolveThreads({ threadIds: ["PRRT_a", "PRRT_b"], cwd: "/repo" });

    // PRRT_a: 2 attempts (retry), PRRT_b: 1 attempt (succeeds on 3rd overall call)
    expect(mockShFile).toHaveBeenCalledTimes(3);
  });
});
