import { describe, it, expect } from "vitest";
import { Semaphore } from "./semaphore.js";

describe("Semaphore", () => {
  it.each([0, -1])(
    "rejects invalid maxConcurrent values (%s)",
    (maxConcurrent) => {
      expect(() => new Semaphore(maxConcurrent)).toThrow(/at least 1/);
    }
  );

  it("allows up to maxConcurrent tasks", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const task = () =>
      sem.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active--;
      });

    await Promise.all([task(), task(), task(), task()]);
    expect(maxActive).toBe(2);
  });

  it("runs all tasks to completion", async () => {
    const sem = new Semaphore(1);
    const results: number[] = [];

    await Promise.all(
      [1, 2, 3].map((n) =>
        sem.run(async () => {
          results.push(n);
        }),
      ),
    );

    expect(results).toHaveLength(3);
  });

  it("releases on error", async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Should still be able to acquire after error
    const result = await sem.run(async () => "ok");
    expect(result).toBe("ok");
  });
});
