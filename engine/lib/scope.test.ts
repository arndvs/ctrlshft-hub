import { describe, it, expect } from "vitest";
import { isPathExcluded, extractPathsFromText, isProposalOutOfScope } from "./scope.js";
import type { SandcastleConfig } from "./config.js";

const makeConfig = (): SandcastleConfig => ({
  model: "test",
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
});

describe("isPathExcluded", () => {
  it("matches exact directories and children", () => {
    expect(isPathExcluded(".sandcastle/engine/lib/config.ts", [".sandcastle"])).toBe(true);
    expect(isPathExcluded("src/app/page.tsx", [".sandcastle"])).toBe(false);
  });

  it("matches workflow globs", () => {
    const patterns = [".github/workflows/agent-*"];
    expect(isPathExcluded(".github/workflows/agent-architecture-review.yml", patterns)).toBe(true);
    expect(isPathExcluded(".github/workflows/sandcastle-ci.yml", patterns)).toBe(false);
  });

  it("matches action globs", () => {
    const patterns = [".github/actions/sandcastle-setup"];
    expect(isPathExcluded(".github/actions/sandcastle-setup/action.yml", patterns)).toBe(true);
  });
});

describe("extractPathsFromText", () => {
  it("extracts tick-quoted and bare paths", () => {
    const text = "Refactor `engine/lib/dispatch.ts` and .sandcastle/workflows/repo-hygiene.ts to use shFile.";
    const paths = extractPathsFromText(text);
    expect(paths.some((p) => p.includes("engine/lib/dispatch.ts"))).toBe(true);
    expect(paths.some((p) => p.includes(".sandcastle/workflows/repo-hygiene.ts"))).toBe(true);
  });
});

describe("isProposalOutOfScope", () => {
  it("flags proposals referencing vendored engine paths", () => {
    const proposal = {
      title: "Typed GitHub client abstraction",
      body: "The engine's GitHub interaction lives in engine/lib/fetch-pr-comments.ts",
      candidatesConsidered: ["Rewrite .sandcastle/engine/lib/dispatch.ts"],
    };
    expect(isProposalOutOfScope(proposal, makeConfig())).toBe(true);
  });

  it("allows proposals on app code", () => {
    const proposal = {
      title: "Stripe billing domain service",
      body: "Extract apps/api/src/billing into a standalone service",
      candidatesConsidered: ["apps/api/src/billing.ts"],
    };
    expect(isProposalOutOfScope(proposal, makeConfig())).toBe(false);
  });
});