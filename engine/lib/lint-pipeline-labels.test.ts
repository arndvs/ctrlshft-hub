import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as child_process from "node:child_process";
import { tmpdir } from "node:os";

/**
 * Integration test for the pipeline label linter.
 * Runs the linter against fixture YAML content and verifies it detects
 * violations / passes clean files.
 */

const LINTER_PATH = path.join(import.meta.dirname, "lint-pipeline-labels.ts");
const TSX_CLI_PATH = path.join(
  import.meta.dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

let fixtureCounter = 0;

function makeFixtureDir(): string {
  fixtureCounter++;
  return fs.mkdtempSync(
    path.join(tmpdir(), `sandcastle-pipeline-labels-${fixtureCounter}-`),
  );
}

function writeFixture(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

function cleanFixtureDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function quoteShellArg(arg: string): string {
  return `"${arg.replaceAll('"', '\\"')}"`;
}

function runLinter(dir: string): { code: number; stdout: string; stderr: string } {
  const args = [LINTER_PATH, "--workflows-dir", dir];
  const command = process.platform === "win32"
    ? [TSX_CLI_PATH, ...args].map(quoteShellArg).join(" ")
    : TSX_CLI_PATH;
  const result = child_process.spawnSync(
    command,
    process.platform === "win32" ? [] : args,
    {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      shell: process.platform === "win32",
    },
  );
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("lint-pipeline-labels", () => {
  it("passes a valid workflow file", () => {
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-valid-test.yml",
      `name: "Agent: Test Valid"
on:
  issues:
    types: [labeled]
jobs:
  plan:
    steps:
      - name: Transition labels
        run: |
          gh issue edit "$N" --remove-label "Sandcastle" || true
          gh issue edit "$N" --add-label "agent:in-progress"
          gh issue edit "$N" --add-label "agent:review"
      - name: Cleanup
        run: |
          gh issue edit "$N" --remove-label "agent:in-progress" || true
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    // Should pass — all labels applied to correct object type
    expect(result.stdout).toContain("✅");
    expect(result.code).toBe(0);
  });

  it("fails when an issue-only label is applied to a PR", () => {
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-invalid-test.yml",
      `name: "Agent: Test Invalid"
on:
  pull_request_target:
    types: [labeled]
jobs:
  bad:
    steps:
      - name: Bad transition
        run: |
          gh pr edit "$N" --add-label "agent:implement"
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    expect(result.stdout).toContain("❌");
    expect(result.stdout).toContain("agent:implement");
    expect(result.code).toBe(1);
  });

  it("fails when a PR-only label is applied to an issue", () => {
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-pr-on-issue-test.yml",
      `name: "Agent: Test PR on Issue"
on:
  issues:
    types: [labeled]
jobs:
  bad:
    steps:
      - name: Bad transition
        run: |
          gh issue edit "$N" --add-label "agent:fix"
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    expect(result.stdout).toContain("❌");
    expect(result.stdout).toContain("agent:fix");
    expect(result.code).toBe(1);
  });

  it("parses backslash-continued label operations", () => {
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-multiline-test.yml",
      `name: "Agent: Test Multiline"
on:
  pull_request_target:
    types: [labeled]
jobs:
  bad:
    steps:
      - name: Bad multiline transition
        run: |
          GH_TOKEN="$TOKEN" gh pr edit "$N" \\
            --add-label "agent:implement" \\
            -R example/repo
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    expect(result.stdout).toContain("❌");
    expect(result.stdout).toContain("agent:implement");
    expect(result.stdout).toContain("agent-multiline-test.yml:11");
    expect(result.code).toBe(1);
  });

  it("fails on an illegal transition (trigger agent:fix → add agent:implement)", () => {
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-illegal-transition-test.yml",
      `name: "Agent: Test Illegal Transition"
on:
  issues:
    types: [labeled]
jobs:
  bad:
    if: github.event.label.name == 'agent:fix'
    steps:
      - name: Illegal transition
        run: |
          gh issue edit "$N" --add-label "agent:implement"
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    expect(result.stdout).toContain("❌");
    expect(result.stdout).toContain("agent:fix");
    expect(result.stdout).toContain("agent:implement");
    expect(result.code).toBe(1);
  });

  it("passes a legal transition (trigger agent:review → add agent:implement)", () => {
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-legal-transition-test.yml",
      `name: "Agent: Test Legal Transition"
on:
  issues:
    types: [labeled]
jobs:
  plan:
    if: github.event.label.name == 'agent:review'
    steps:
      - name: Legal transition
        run: |
          gh issue edit "$N" --remove-label "agent:review" || true
          gh issue edit "$N" --add-label "agent:implement"
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    expect(result.stdout).toContain("✅");
    expect(result.code).toBe(0);
  });

  it("fails when a workflow adds a label mutually exclusive with the trigger but forgets to remove it", () => {
    // Trigger is agent:fix; the workflow adds agent:merge (mutually exclusive
    // with agent:fix) but never removes the trigger label. Seeding `current`
    // with the trigger label must catch this conflict.
    const dir = makeFixtureDir();
    writeFixture(
      dir,
      "agent-mutual-exclusion-trigger-test.yml",
      `name: "Agent: Test Mutual Exclusion with Trigger"
on:
  pull_request_target:
    types: [labeled]
jobs:
  bad:
    if: github.event.label.name == 'agent:fix'
    steps:
      - name: Adds mutually-exclusive label without removing trigger
        run: |
          gh pr edit "$N" --add-label "agent:merge"
`,
    );

    const result = runLinter(dir);
    cleanFixtureDir(dir);
    expect(result.stdout).toContain("❌");
    expect(result.stdout).toContain("Mutual exclusion");
    expect(result.code).toBe(1);
  });
});
