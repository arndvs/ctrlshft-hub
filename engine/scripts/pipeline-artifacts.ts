import * as fs from "node:fs";
import * as path from "node:path";
import {
  renderLabelCatalogJson,
  renderPipelineLabelShell,
} from "../lib/render-pipeline-artifacts.js";

type Mode = "--check" | "--write";

interface PipelineArtifact {
  path: string;
  render: () => string;
}

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CURRENT_DIR_WRITE_COMMAND = "pnpm pipeline-artifacts:write";
const REPO_ROOT_WRITE_COMMAND = "pnpm --dir engine pipeline-artifacts:write";

const ARTIFACTS: PipelineArtifact[] = [
  {
    path: "bin/pipeline-label-data.sh",
    render: renderPipelineLabelShell,
  },
  {
    path: "templates/labels.json",
    render: renderLabelCatalogJson,
  },
];

function normalizeNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n");
}

function parseMode(): Mode {
  const mode = process.argv[2] ?? "--check";
  if (mode === "--check" || mode === "--write") return mode;

  console.error("Usage: pnpm pipeline-artifacts:check");
  console.error("   or: pnpm pipeline-artifacts:write");
  process.exit(2);
}

function checkArtifacts(): number {
  const stale: string[] = [];

  for (const artifact of ARTIFACTS) {
    const artifactPath = path.join(ROOT, artifact.path);
    const actual = fs.existsSync(artifactPath)
      ? normalizeNewlines(fs.readFileSync(artifactPath, "utf8"))
      : "";
    const expected = artifact.render();

    if (actual !== expected) stale.push(artifact.path);
  }

  if (stale.length === 0) {
    console.log("Pipeline artifacts are up to date.");
    return 0;
  }

  console.error("Pipeline artifacts are stale:");
  for (const artifactPath of stale) console.error(`  - ${artifactPath}`);
  console.error("");
  console.error(`Run from the current directory: ${CURRENT_DIR_WRITE_COMMAND}`);
  console.error(`Or from the repo root: ${REPO_ROOT_WRITE_COMMAND}`);
  return 1;
}

function writeArtifacts(): void {
  for (const artifact of ARTIFACTS) {
    const artifactPath = path.join(ROOT, artifact.path);
    fs.writeFileSync(artifactPath, artifact.render(), "utf8");
    console.log(`Wrote ${artifact.path}`);
  }
}

const mode = parseMode();
if (mode === "--write") {
  writeArtifacts();
} else {
  process.exitCode = checkArtifacts();
}
