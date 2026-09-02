import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, resolveExcludedPaths } from "./config.js";

describe("loadConfig", () => {
  let tempDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sandcastle-config-"));
    // Isolate env vars that loadConfig reads
    for (const key of ["SANDCASTLE_MODEL", "SANDCASTLE_BASE_BRANCH", "SANDCASTLE_SANDBOX", "SANDCASTLE_PACKAGE_MANAGER", "ANTHROPIC_MODEL"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns all defaults when config file is missing", async () => {
    const config = await loadConfig({ cwd: tempDir });

    expect(config.model).toBe("claude-opus-4-7");
    expect(config.baseBranch).toBe("main");
    expect(config.sandbox).toBe("none");
    expect(config.promptDir).toBe(".sandcastle/prompts");
    expect(config.codingStandards).toBe(".sandcastle/CODING_STANDARDS.md");
    expect(config.testingPrinciples).toBe(".sandcastle/testing-principles.md");
    expect(config.contextDoc).toBe("CONTEXT.md");
    expect(config.adrDir).toBe("docs/adr");
    expect(config.packageManager).toBe("pnpm");
  });

  it("merges partial config with defaults", async () => {
    writeFileSync(
      join(tempDir, "sandcastle.config.json"),
      JSON.stringify({ model: "claude-sonnet-4-20250514", baseBranch: "dev" }),
    );

    const config = await loadConfig({ cwd: tempDir });

    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.baseBranch).toBe("dev");
    expect(config.sandbox).toBe("none"); // default
    expect(config.packageManager).toBe("pnpm"); // default
  });

  it("throws on invalid config values", async () => {
    writeFileSync(
      join(tempDir, "sandcastle.config.json"),
      JSON.stringify({ sandbox: "invalid-value" }),
    );

    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow();
  });

  it("accepts the supported sandbox value", async () => {
    writeFileSync(
      join(tempDir, "sandcastle.config.json"),
      JSON.stringify({ sandbox: "none" }),
    );

    const config = await loadConfig({ cwd: tempDir });

    expect(config.sandbox).toBe("none");
  });

  it.each(["docker", "worktree"])("rejects unsupported sandbox value %s", async (sandbox) => {
    writeFileSync(
      join(tempDir, "sandcastle.config.json"),
      JSON.stringify({ sandbox }),
    );

    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow(/Only sandbox/);
  });

  it("rejects unsupported sandbox environment overrides", async () => {
    process.env["SANDCASTLE_SANDBOX"] = "docker";

    await expect(loadConfig({ cwd: tempDir })).rejects.toThrow(/Only sandbox/);
  });

  it("accepts all valid package manager values", async () => {
    for (const packageManager of ["npm", "pnpm", "yarn", "bun"] as const) {
      writeFileSync(
        join(tempDir, "sandcastle.config.json"),
        JSON.stringify({ packageManager }),
      );
      const config = await loadConfig({ cwd: tempDir });
      expect(config.packageManager).toBe(packageManager);
    }
  });

  it("respects environment variable overrides", async () => {
    process.env["SANDCASTLE_MODEL"] = "claude-haiku";
    const config = await loadConfig({ cwd: tempDir });
    expect(config.model).toBe("claude-haiku");
  });

  it("falls back to ANTHROPIC_MODEL when SANDCASTLE_MODEL is not set", async () => {
    process.env["ANTHROPIC_MODEL"] = "claude-opus-4-7";
    const config = await loadConfig({ cwd: tempDir });
    expect(config.model).toBe("claude-opus-4-7");
  });

  it("prefers SANDCASTLE_MODEL over ANTHROPIC_MODEL", async () => {
    process.env["SANDCASTLE_MODEL"] = "claude-haiku";
    process.env["ANTHROPIC_MODEL"] = "claude-opus-4-7";
    const config = await loadConfig({ cwd: tempDir });
    expect(config.model).toBe("claude-haiku");
  });

  it("defaults excludedPaths to empty and resolveExcludedPaths returns vendored defaults", async () => {
    const config = await loadConfig({ cwd: tempDir });
    expect(config.excludedPaths).toEqual([]);
    expect(config.disabledWorkflows).toEqual([]);

    const excluded = resolveExcludedPaths(config);
    expect(excluded).toContain(".sandcastle");
    expect(excluded).toContain("sandcastle-hub");
    expect(excluded).toContain(".github/workflows/agent-*");
    expect(excluded).toContain(".refactor");
  });

  it("merges project excludedPaths with vendored defaults (deduped)", async () => {
    writeFileSync(
      join(tempDir, "sandcastle.config.json"),
      JSON.stringify({ excludedPaths: ["docs/private/", ".sandcastle"] }),
    );

    const config = await loadConfig({ cwd: tempDir });
    const excluded = resolveExcludedPaths(config);

    expect(excluded).toContain("docs/private/");
    expect(excluded).toContain(".sandcastle");
    // Deduped: .sandcastle appears once
    expect(excluded.filter((p) => p === ".sandcastle")).toHaveLength(1);
    // Defaults still present
    expect(excluded).toContain(".github/workflows/agent-*");
  });

  it("reads disabledWorkflows from config", async () => {
    writeFileSync(
      join(tempDir, "sandcastle.config.json"),
      JSON.stringify({ disabledWorkflows: ["architecture-review", "repo-hygiene"] }),
    );

    const config = await loadConfig({ cwd: tempDir });
    expect(config.disabledWorkflows).toEqual(["architecture-review", "repo-hygiene"]);
  });
});
