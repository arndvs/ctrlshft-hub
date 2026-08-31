import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { waitForSessionFile, sessionFileExists } from "./wait-for-session-file.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn() };
});

const mockExistsSync = vi.mocked(existsSync);

describe("waitForSessionFile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockExistsSync.mockReset();
    mockExistsSync.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true immediately when the session file already exists", async () => {
    mockExistsSync.mockReturnValue(true);
    const result = await waitForSessionFile("sess-1", { timeoutMs: 1000, intervalMs: 50 });
    expect(result).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
  });

  it("returns true when the file appears within the timeout", async () => {
    // File appears on the 3rd poll (after 2 misses).
    mockExistsSync
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    const promise = waitForSessionFile("sess-1", { timeoutMs: 1000, intervalMs: 50 });
    // Advance timers to let the polling loop run.
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toBe(true);
    expect(mockExistsSync.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("returns false after the timeout when the file never appears", async () => {
    mockExistsSync.mockReturnValue(false);
    const promise = waitForSessionFile("sess-1", { timeoutMs: 100, intervalMs: 50 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result).toBe(false);
  });

  it("uses default timeout and interval when not provided", async () => {
    mockExistsSync.mockReturnValue(false);
    const promise = waitForSessionFile("sess-1");
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await promise;
    expect(result).toBe(false);
  });
});

describe("sessionFileExists", () => {
  it("delegates to existsSync on the host session store path", () => {
    mockExistsSync.mockReturnValue(true);
    const result = sessionFileExists("sess-1");
    expect(result).toBe(true);
    // The path must end with the session id + .jsonl (the host store layout).
    const calledPaths = mockExistsSync.mock.calls.map((c) => c[0] as string);
    expect(calledPaths.some((p) => p.endsWith("sess-1.jsonl"))).toBe(true);
  });
});