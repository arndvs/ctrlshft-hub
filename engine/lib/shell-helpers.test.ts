import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { required, fail, outputDirPath, sh, shFile, shFileInherit, safeSh } from "./shell-helpers.js";

describe("required", () => {
  const ENV_KEY = "SHELL_HELPERS_TEST_VAR";

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("returns env var value when set", () => {
    process.env[ENV_KEY] = "hello";
    expect(required(ENV_KEY)).toBe("hello");
  });

  it("throws when env var is missing", () => {
    delete process.env[ENV_KEY];
    expect(() => required(ENV_KEY)).toThrow(`Missing required env var: ${ENV_KEY}`);
  });

  it("throws when env var is empty string", () => {
    process.env[ENV_KEY] = "";
    expect(() => required(ENV_KEY)).toThrow(`Missing required env var: ${ENV_KEY}`);
  });
});

describe("fail", () => {
  const testDir = join(tmpdir(), "shell-helpers-test-" + Date.now());
  const savedOutputDir = process.env.OUTPUT_DIR;

  afterEach(() => {
    if (savedOutputDir !== undefined) {
      process.env.OUTPUT_DIR = savedOutputDir;
    } else {
      delete process.env.OUTPUT_DIR;
    }
    try {
      rmSync(testDir, { recursive: true });
    } catch {}
  });

  it("writes failure_reason.txt and throws", () => {
    mkdirSync(testDir, { recursive: true });
    process.env.OUTPUT_DIR = testDir;

    expect(() => fail("something broke")).toThrow("something broke");

    const content = readFileSync(join(testDir, "failure_reason.txt"), "utf8");
    expect(content).toBe("something broke");
  });

  it("uses the OS temp directory when OUTPUT_DIR is unset", () => {
    delete process.env.OUTPUT_DIR;

    expect(outputDirPath()).toBe(tmpdir());
  });
});

describe("sh", () => {
  it("executes command and returns stdout", () => {
    const result = sh('node -e "console.log(\'hello\')"');
    expect(result.trim()).toBe("hello");
  });

  it("throws on failed command", () => {
    expect(() => sh('node -e "process.exit(1)"')).toThrow();
  });

  it("accepts optional cwd as string", () => {
    const result = sh('node -e "console.log(process.cwd())"', tmpdir());
    expect(result.trim()).toBeTruthy();
  });

  it("accepts ShellOpts object", () => {
    const result = sh('node -e "console.log(process.cwd())"', { cwd: tmpdir() });
    expect(result.trim()).toBeTruthy();
  });

  it("forwards input to stdin", () => {
    const result = sh("node -e \"process.stdin.pipe(process.stdout)\"", { input: "hello" });
    expect(result).toBe("hello");
  });

  it("forwards empty string input to stdin", () => {
    const result = sh("node -e \"process.stdin.on('end', () => console.log('done')); process.stdin.resume()\"", { input: "" });
    expect(result.trim()).toBe("done");
  });

  it("throws ETIMEDOUT when command exceeds timeout", () => {
    try {
      sh('node -e "setTimeout(() => {}, 10000)"', { timeout: 500 });
      throw new Error("Expected command to time out");
    } catch (err) {
      expect(err).toMatchObject({ code: "ETIMEDOUT" });
    }
  });
});

describe("shFile", () => {
  it("executes command and returns stdout", () => {
    const result = shFile("node", ["-e", "console.log('hello')"]);
    expect(result.trim()).toBe("hello");
  });

  it("throws on failed command", () => {
    expect(() => shFile("node", ["-e", "process.exit(1)"])).toThrow();
  });

  it("accepts ShellOpts object", () => {
    const result = shFile("node", ["-e", "console.log(process.cwd())"], { cwd: tmpdir() });
    expect(result.trim()).toBeTruthy();
  });

  it("forwards empty string input to stdin", () => {
    const result = shFile("node", ["-e", "process.stdin.on('end', () => console.log('done')); process.stdin.resume()"], { input: "" });
    expect(result.trim()).toBe("done");
  });

  it("throws when command exceeds timeout", () => {
    expect(() => shFile("node", ["-e", "setTimeout(() => {}, 10000)"], { timeout: 500 })).toThrow();
  });
});

describe("shFileInherit", () => {
  it("executes command without throwing on success", () => {
    expect(() => shFileInherit("node", ["-e", "process.exit(0)"])).not.toThrow();
  });

  it("throws on failed command", () => {
    expect(() => shFileInherit("node", ["-e", "process.exit(1)"])).toThrow();
  });

  it("forwards input to stdin", () => {
    expect(() => shFileInherit("node", ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"], { input: "hello" })).not.toThrow();
  });

  it("accepts empty string input", () => {
    expect(() => shFileInherit("node", ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"], { input: "" })).not.toThrow();
  });
});

describe("safeSh", () => {
  it("returns stdout on success", () => {
    const result = safeSh('node -e "console.log(\'hello\')"');
    expect(result.trim()).toBe("hello");
  });

  it("returns empty string on failure", () => {
    expect(safeSh('node -e "process.exit(1)"')).toBe("");
  });
});
