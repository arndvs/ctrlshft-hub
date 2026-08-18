import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePrompt, configPromptArgs, extractPromptPlaceholders, filterPromptArgs } from "./resolve-prompt.js";
import type { SandcastleConfig } from "./config.js";

function makeConfig(overrides: Partial<SandcastleConfig> = {}): SandcastleConfig {
  return {
    model: "claude-opus-4-6",
    baseBranch: "main",
    sandbox: "none",
    promptDir: ".sandcastle/prompts",
    codingStandards: ".sandcastle/CODING_STANDARDS.md",
    testingPrinciples: ".sandcastle/testing-principles.md",
    contextDoc: "CONTEXT.md",
    adrDir: "docs/adr",
    packageManager: "pnpm",
    excludedPaths: [],
    disabledWorkflows: [],
    ...overrides,
  };
}

describe("resolvePrompt", () => {
  let tempDir: string;
  let templatesDir: string;
  let overrideDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "resolve-prompt-"));
    templatesDir = join(tempDir, "templates");
    overrideDir = join(tempDir, "overrides");
    mkdirSync(templatesDir, { recursive: true });
    mkdirSync(overrideDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns template path when no override exists", async () => {
    writeFileSync(join(templatesDir, "review.md"), "default review prompt");

    const result = await resolvePrompt({
      name: "review",
      config: makeConfig(),
      repoDir: tempDir,
      templatesDir,
    });

    expect(result).toBe(join(templatesDir, "review.md"));
  });

  it("returns override path when override exists", async () => {
    writeFileSync(join(templatesDir, "review.md"), "default review prompt");
    writeFileSync(join(overrideDir, "review.md"), "custom review prompt");

    const result = await resolvePrompt({
      name: "review",
      config: makeConfig({ promptDir: overrideDir }),
      repoDir: tempDir,
      templatesDir,
    });

    expect(result).toBe(join(overrideDir, "review.md"));
  });

  it("falls back to template when override directory does not exist", async () => {
    writeFileSync(join(templatesDir, "review.md"), "default review prompt");

    const result = await resolvePrompt({
      name: "review",
      config: makeConfig({ promptDir: join(tempDir, "nonexistent") }),
      repoDir: tempDir,
      templatesDir,
    });

    expect(result).toBe(join(templatesDir, "review.md"));
  });

  it("throws when neither override nor template exists", async () => {
    await expect(
      resolvePrompt({
        name: "nonexistent",
        config: makeConfig(),
        repoDir: tempDir,
        templatesDir,
      }),
    ).rejects.toThrow("nonexistent.md");
  });

  it("resolves override path relative to repoDir when promptDir is relative", async () => {
    const relOverrideDir = join(tempDir, ".sandcastle", "prompts");
    mkdirSync(relOverrideDir, { recursive: true });
    writeFileSync(join(relOverrideDir, "review.md"), "relative override");
    writeFileSync(join(templatesDir, "review.md"), "default");

    const result = await resolvePrompt({
      name: "review",
      config: makeConfig({ promptDir: ".sandcastle/prompts" }),
      repoDir: tempDir,
      templatesDir,
    });

    expect(result).toBe(join(relOverrideDir, "review.md"));
  });
});

describe("configPromptArgs", () => {
  it("returns config-derived template variables", () => {
    const config = makeConfig({
      contextDoc: "MY_CTX.md",
      codingStandards: "STANDARDS.md",
      testingPrinciples: "PRINCIPLES.md",
      adrDir: "adrs",
      baseBranch: "dev",
    });

    const args = configPromptArgs(config);

    expect(args).toEqual({
      CONTEXT_DOC: "MY_CTX.md",
      CODING_STANDARDS: "STANDARDS.md",
      TESTING_PRINCIPLES: "PRINCIPLES.md",
      ADR_DIR: "adrs",
      BASE_BRANCH: "dev",
      OUT_OF_SCOPE_PATHS: [
        ".sandcastle",
        ".github/actions/sandcastle-setup",
        ".github/actions/sandcastle-teardown",
        ".github/workflows/agent-*",
        ".github/workflows/check-*",
        ".github/workflows/labels-*",
        ".github/workflows/require-*",
        ".github/workflows/sandcastle-*",
        ".github/copilot-setup-steps.yml",
        ".refactor",
      ].join(", "),
    });
  });

  describe("prompt arg filtering", () => {
    it("extracts placeholders with optional whitespace and case differences", () => {
      expect([...extractPromptPlaceholders("{{ BASE_BRANCH }} {{context_doc}}")]).toEqual(["BASE_BRANCH", "CONTEXT_DOC"]);
    });

    it("keeps only args consumed by the prompt file", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "prompt-args-"));
      try {
        const promptFile = join(tempDir, "prompt.md");
        writeFileSync(promptFile, "Read {{ CONTEXT_DOC }} on branch {{branch}}.");

        expect(filterPromptArgs(promptFile, {
          CONTEXT_DOC: "CONTEXT.md",
          BRANCH: "feature/test",
          CODING_STANDARDS: ".sandcastle/CODING_STANDARDS.md",
        })).toEqual({
          CONTEXT_DOC: "CONTEXT.md",
          BRANCH: "feature/test",
        });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  it("uses default config values", () => {
    const args = configPromptArgs(makeConfig());

    expect(args.CONTEXT_DOC).toBe("CONTEXT.md");
    expect(args.BASE_BRANCH).toBe("main");
  });
});
