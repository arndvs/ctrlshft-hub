import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDefaultExtractionsDir, resolveDefaultTemplatesDir } from "./default-template-paths.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function createTempDir(): string {
  const tempDir = mkdtempSync(path.join(tmpdir(), "sandcastle-paths-"));
  tempDirs.push(tempDir);
  return tempDir;
}

describe("default Sandcastle template paths", () => {
  it("resolves the hub layout with engine/ and templates/ as siblings", () => {
    const root = createTempDir();
    const workflowDir = path.join(root, "engine", "workflows");
    const promptsDir = path.join(root, "templates", "prompts");
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(promptsDir, { recursive: true });

    expect(resolveDefaultTemplatesDir({ workflowDir })).toBe(promptsDir);
  });

  it("resolves the stamped layout under .sandcastle/templates", () => {
    const root = createTempDir();
    const workflowDir = path.join(root, ".sandcastle", "engine", "workflows");
    const promptsDir = path.join(root, ".sandcastle", "templates", "prompts");
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(promptsDir, { recursive: true });

    expect(resolveDefaultTemplatesDir({ workflowDir })).toBe(promptsDir);
  });

  it("resolves extraction templates for stamped workflows", () => {
    const root = createTempDir();
    const workflowDir = path.join(root, ".sandcastle", "engine", "workflows");
    const extractionsDir = path.join(root, ".sandcastle", "templates", "extractions");
    mkdirSync(workflowDir, { recursive: true });
    mkdirSync(extractionsDir, { recursive: true });

    expect(resolveDefaultExtractionsDir({ workflowDir })).toBe(extractionsDir);
  });

  it("throws with checked paths when templates cannot be found", () => {
    const root = createTempDir();
    const workflowDir = path.join(root, ".sandcastle", "engine", "workflows");
    mkdirSync(workflowDir, { recursive: true });

    expect(() => resolveDefaultTemplatesDir({ workflowDir })).toThrow("Unable to locate prompt templates");
  });
});