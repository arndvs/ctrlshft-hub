import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configPromptArgs } from "./resolve-prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, "..", "..", "templates");
const repoRoot = join(__dirname, "..", "..", "..");
const promptDirs = [
  { label: "templates", path: join(templatesDir, "prompts") },
  { label: "sandcastle templates", path: join(repoRoot, ".sandcastle", "templates", "prompts") },
  { label: "sandcastle overrides", path: join(repoRoot, ".sandcastle", "prompts") },
] as const;

const extractionWorkflows = ["architecture-review", "implement-pr", "update-branch", "keep-tests-tight", "repo-hygiene"] as const;
const workflowPromptArgs = {
  "address-review": ["PR_NUMBER", "BRANCH", "COMMENTS_JSON"],
  "architecture-review": [],
  "implement-issue": ["ISSUE_NUMBER", "ISSUE_TITLE", "BRANCH"],
  "implement-pr": ["PR_NUMBER", "BRANCH", "ISSUE_NUMBER", "ISSUE_TITLE", "PR_COMMENTS_JSON"],
  "implement-prd": ["PRD_NUMBER", "PRD_TITLE", "SUB_ISSUE_NUMBER", "SUB_ISSUE_TITLE", "BRANCH"],
  "keep-tests-tight": ["BRANCH", "TESTING_PRINCIPLES"],
  "repo-hygiene": ["DRY_RUN"],
  review: ["PR_NUMBER", "PR_COMMENTS_JSON"],
  "to-issues-prd": ["ISSUE_NUMBER"],
  "update-branch": ["PR_NUMBER", "BRANCH", "BASE_REF"],
  "write-pr": ["ISSUE_NUMBER", "ISSUE_TITLE", "BRANCH"],
  "write-prd-pr": ["PRD_NUMBER", "PRD_TITLE"],
} as const;
const sandcastleBuiltInArgNames = ["SOURCE_BRANCH", "TARGET_BRANCH"] as const;

const configArgNames = Object.keys(configPromptArgs({
  model: "test-model",
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
}));

function promptCases(): Array<{ label: string; name: keyof typeof workflowPromptArgs; content: string }> {
  return promptDirs.flatMap((dir) => {
    if (!existsSync(dir.path)) return [];

    return readdirSync(dir.path)
      .filter((filename) => filename.endsWith(".md"))
      // Referenced artifacts (e.g. testing-principles.md) are not workflow
      // prompts and have no prompt-arg contract.
      .filter((filename) => filename !== "testing-principles.md")
      .map((filename) => ({
        label: `${dir.label}/${filename}`,
        name: filename.replace(/\.md$/, "") as keyof typeof workflowPromptArgs,
        content: readFileSync(join(dir.path, filename), "utf8"),
      }));
  });
}

function extractPlaceholders(content: string): string[] {
  return [...content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!.trim().toUpperCase());
}

describe("two-phase prompt contracts", () => {
  it.each(extractionWorkflows)("keeps %s produce prompt free of structured-output tags", (workflow) => {
    const prompt = readFileSync(join(templatesDir, "prompts", `${workflow}.md`), "utf8");

    expect(prompt).not.toContain("<output>");
    expect(prompt).not.toContain("</output>");
  });

  it.each(extractionWorkflows)("keeps %s extraction prompt responsible for structured output", (workflow) => {
    const prompt = readFileSync(join(templatesDir, "extractions", `${workflow}.md`), "utf8");

    expect(prompt).toContain("<output>");
    expect(prompt).toContain("</output>");
  });
});

describe("prompt argument contracts", () => {
  it("extracts placeholders with optional whitespace and case differences", () => {
    expect(extractPlaceholders("{{ BASE_BRANCH }} {{context_doc}}")).toEqual(["BASE_BRANCH", "CONTEXT_DOC"]);
  });

  it.each(promptCases())("keeps $label placeholders backed by supplied args", ({ name, content }) => {
    const promptArgs = workflowPromptArgs[name];
    expect(promptArgs, `Missing workflow prompt arg contract for ${String(name)}`).toBeDefined();

    const suppliedArgs = new Set([...configArgNames, ...promptArgs, ...sandcastleBuiltInArgNames]);
    const unknownPlaceholders = extractPlaceholders(content).filter((placeholder) => !suppliedArgs.has(placeholder));

    expect(unknownPlaceholders).toEqual([]);
  });

  it.each(promptCases())("keeps $label workflow-supplied args consumed by its prompt", ({ name, content }) => {
    const promptArgs = workflowPromptArgs[name];
    expect(promptArgs, `Missing workflow prompt arg contract for ${String(name)}`).toBeDefined();

    const placeholders = new Set(extractPlaceholders(content));
    const unusedPromptArgs = promptArgs.filter((arg) => !placeholders.has(arg));

    expect(unusedPromptArgs).toEqual([]);
  });

  it("keeps config-derived prompt args consumed by at least one active prompt", () => {
    const activePlaceholders = new Set(promptCases().flatMap((prompt) => extractPlaceholders(prompt.content)));
    const unusedConfigArgs = configArgNames.filter((arg) => !activePlaceholders.has(arg));

    expect(unusedConfigArgs).toEqual([]);
  });

  it.each(promptCases())("keeps $label free of hardcoded configurable context paths", ({ content }) => {
    expect(content).not.toContain("CONTEXT.md");
    expect(content).not.toContain("docs/adr");
  });
});
