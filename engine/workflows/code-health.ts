import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { claudeCode, Output } from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { runWithExtraction } from "../lib/run-with-extraction.js";
import { CodeHealthOutput } from "../schemas/code-health-output.js";
import { loadConfig } from "../lib/config.js";
import { resolvePrompt, configPromptArgs, filterPromptArgs } from "../lib/resolve-prompt.js";
import { resolveDefaultExtractionsDir, resolveDefaultTemplatesDir } from "../lib/default-template-paths.js";
import { shFile } from "../lib/shell-helpers.js";
import { isProposalOutOfScope } from "../lib/scope.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultTemplatesDir = resolveDefaultTemplatesDir({ workflowDir: __dirname });
const defaultExtractionsDir = resolveDefaultExtractionsDir({ workflowDir: __dirname });

export type CodeHealthResult = CodeHealthOutput;

/** Read a JSON file, returning a fallback when absent or malformed. */
function readJsonFile<T>(path: string | undefined, fallback: T): T {
  if (!path || !existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    console.warn(`[code-health] Could not parse ${path}; continuing without it.`);
    return fallback;
  }
}

/** A single code-health finding, as published to a GitHub issue. */
export interface PublishedFinding {
  fingerprint: string;
  lens: string;
  severity: "high" | "medium" | "low";
  title: string;
  issueUrl: string;
  issueNumber: number;
}

/** The shape of a finding in a `proposed` code-health result. */
export interface CodeHealthFinding {
  fingerprint: string;
  lens: string;
  severity: "high" | "medium" | "low";
  title: string;
  body: string;
  allowlist: string[];
}

/**
 * Check whether a code-health finding is already open. The audit must never
 * open a second issue while one is pending — a backed-up queue means findings
 * are too big, and the fix is smaller findings, not more of them.
 */
export function hasOpenCodeHealthIssue(repoDir: string, label = "source:code-health"): boolean {
  const output = shFile(
    "gh",
    ["issue", "list", "--label", label, "--state", "open", "--json", "number", "--jq", "length"],
    repoDir
  );
  const count = Number(output.trim());
  return Number.isFinite(count) && count > 0;
}

/**
 * Publish one GitHub issue per finding. The audit never applies `agent:ready`
 * itself — tagging IS the acceptance step, and an audit that tags its own
 * proposals is auto-merge with extra ceremony. It creates the issue with the
 * `source:code-health` and `lens:<name>` labels; a human applies `agent:ready`
 * to hand it to the implementer workflow.
 *
 * Each issue body carries two machine-readable HTML comment blocks:
 *   - `code-health-fingerprints` — for dedup on the next run
 *   - `code-health-allowlist` — the path globs the implementer may modify,
 *     enforced by check-allowlist.sh in CI
 */
export function publishFindings(opts: {
  findings: CodeHealthFinding[];
  repoDir: string;
  repo: string;
  readyLabel?: string;
  sourceLabel?: string;
}): PublishedFinding[] {
  const { findings, repoDir, repo, readyLabel = "agent:ready", sourceLabel = "source:code-health" } = opts;
  const published: PublishedFinding[] = [];

  for (const finding of findings) {
    const body = [
      finding.body,
      "",
      "---",
      `Apply \`${readyLabel}\` to hand this to an implementer agent.`,
      "",
      "<!-- code-health-fingerprints",
      finding.fingerprint,
      "-->",
      "<!-- code-health-allowlist",
      ...finding.allowlist,
      "-->",
    ].join("\n");

    const issueUrl = shFile(
      "gh",
      [
        "issue", "create",
        "--repo", repo,
        "--title", finding.title,
        "--body", body,
        "--label", sourceLabel,
        "--label", `lens:${finding.lens}`,
      ],
      repoDir,
    ).trim();

    const match = issueUrl.match(/\/(\d+)$/);
    if (!match) {
      throw new Error(`Failed to parse issue number from gh issue create output: ${issueUrl}`);
    }

    published.push({
      fingerprint: finding.fingerprint,
      lens: finding.lens,
      severity: finding.severity,
      title: finding.title,
      issueUrl,
      issueNumber: parseInt(match[1]!, 10),
    });
  }

  return published;
}

export async function runCodeHealth(opts: {
  repoDir: string;
  model?: string;
  templatesDir?: string;
  extractionsDir?: string;
  lens?: string;
  dryRun?: boolean;
  frictionCandidatesFile?: string;
  knownFindingsFile?: string;
}): Promise<CodeHealthResult> {
  const config = await loadConfig({ cwd: opts.repoDir });
  const model = opts.model ?? config.model;
  const templatesDir = opts.templatesDir ?? defaultTemplatesDir;
  const extractionsDir = opts.extractionsDir ?? defaultExtractionsDir;

  // Open-issue guard: skip the agent entirely when a finding is already pending.
  if (hasOpenCodeHealthIssue(opts.repoDir)) {
    console.log("[code-health] A code-health finding is already open — skipping proposal.");
    return { status: "skipped", reason: "a code-health finding is already open" };
  }

  const promptFile = await resolvePrompt({ name: "code-health", config, repoDir: opts.repoDir, templatesDir });
  const extractionPrompt = readFileSync(path.join(extractionsDir, "code-health.md"), "utf8");

  // Friction evidence: ranked candidates from consolidate-friction.py and known
  // fingerprints from collect-known-findings.sh. These let the lens agent rank
  // by measured cost and suppress already-known findings — the whole advantage
  // of collecting observations at all. Absent files degrade to empty JSON.
  const frictionCandidates = readJsonFile(opts.frictionCandidatesFile, { candidates: [], observations: [] });
  const knownFindings = readJsonFile(opts.knownFindingsFile, { open: [], fixed: [], declined: [] });

  const result = await runWithExtraction({
    name: `code-health-${new Date().toISOString().slice(0, 10)}`,
    agent: claudeCode(model),
    sandbox: noSandbox(),
    cwd: opts.repoDir,
    promptFile,
    promptArgs: filterPromptArgs(promptFile, {
      ...configPromptArgs(config),
      LENS: opts.lens ?? "",
      DRY_RUN: opts.dryRun ? "true" : "false",
      FRICTION_CANDIDATES: JSON.stringify(frictionCandidates, null, 2),
      KNOWN_FINDINGS: JSON.stringify(knownFindings, null, 2),
    }),
    output: Output.object({ tag: "output", schema: CodeHealthOutput }),
    extractionPrompt,
    logging: { type: "stdout" },
  });

  // Backstop: never propose changes to vendored/producer-owned paths even if
  // the model ignored the prompt's OUT_OF_SCOPE_PATHS section. Each finding is
  // checked individually — a finding that references an excluded path is
  // dropped, and if every finding is out of scope the whole proposal is skipped.
  if (result.output.status === "proposed") {
    const inScope = result.output.findings.filter((finding) =>
      !isProposalOutOfScope(
        { title: finding.title, body: finding.body, candidatesConsidered: [] },
        config,
      ),
    );
    if (inScope.length === 0) {
      console.warn(
        "[code-health] All findings reference out-of-scope (vendored/producer-owned) paths — refusing to publish.",
      );
      return { status: "skipped", reason: "all findings target out-of-scope paths" };
    }
    if (inScope.length < result.output.findings.length) {
      console.warn(
        `[code-health] Dropped ${result.output.findings.length - inScope.length} finding(s) referencing out-of-scope paths.`,
      );
    }
    console.log(`[code-health] Proposed ${inScope.length} finding(s)`);
    return { status: "proposed", findings: inScope };
  }

  console.log(`[code-health] ${result.output.status}: ${result.output.reason}`);

  return result.output;
}