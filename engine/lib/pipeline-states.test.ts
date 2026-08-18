import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  validateTransition,
  LABELS,
  MUTUAL_EXCLUSIONS,
  TRANSITIONS,
} from "./pipeline-states.js";
import {
  renderLabelCatalogJson,
  renderPipelineLabelShell,
} from "./render-pipeline-artifacts.js";

interface MarkdownStateRow {
  label: string;
  nextLabels: string[];
}

const CONTRACT_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "instructions",
  "sandcastle-pipeline.instructions.md",
);

const PIPELINE_LABEL_DATA_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "bin",
  "pipeline-label-data.sh",
);

// In the hub, templates/labels.json is the canonical label catalogue
// (there is no producer-style .sandcastle/ + shft/templates/ duality).
const TEMPLATE_LABELS_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "templates",
  "labels.json",
);

const INSTALLED_LABELS_PATH = TEMPLATE_LABELS_PATH;

function extractBacktickedLabels(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
}

function extractMarkdownStateRows(): MarkdownStateRow[] {
  const markdown = fs.readFileSync(CONTRACT_PATH, "utf8");
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    line.trim() === "| Label | Applied by | Triggers | → Next state |"
  );

  if (headerIndex === -1) {
    throw new Error(`State machine table not found in ${CONTRACT_PATH}`);
  }

  const rows: MarkdownStateRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) break;

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const [label] = extractBacktickedLabels(cells[0] ?? "");
    if (!label) continue;

    rows.push({
      label,
      nextLabels: extractBacktickedLabels(cells[3] ?? ""),
    });
  }

  return rows;
}

describe("pipeline-states", () => {
  describe("LABELS catalogue", () => {
    it("every label has at least one applicable object type", () => {
      for (const [name, def] of Object.entries(LABELS)) {
        expect(def.appliesTo.length, `${name} appliesTo is empty`).toBeGreaterThan(0);
      }
    });

    it("all transition targets exist in the catalogue", () => {
      for (const [from, toSet] of TRANSITIONS) {
        expect(LABELS[from], `source "${from}" not in LABELS`).toBeDefined();
        for (const to of toSet) {
          expect(LABELS[to], `target "${to}" not in LABELS`).toBeDefined();
        }
      }
    });

    it("mutual exclusions reference valid labels", () => {
      for (const [a, b] of MUTUAL_EXCLUSIONS) {
        expect(LABELS[a], `exclusion member "${a}" not in LABELS`).toBeDefined();
        expect(LABELS[b], `exclusion member "${b}" not in LABELS`).toBeDefined();
      }
    });

    it("stays aligned with the markdown label contract", () => {
      const rows = extractMarkdownStateRows();
      const rowByLabel = new Map(rows.map((row) => [row.label, row]));

      expect([...rowByLabel.keys()].sort()).toEqual(Object.keys(LABELS).sort());

      for (const [from, targets] of TRANSITIONS) {
        const row = rowByLabel.get(from);
        expect(row, `missing markdown row for transition source "${from}"`).toBeDefined();
        expect(row!.nextLabels.sort()).toEqual([...targets].sort());
      }
    });

    it("does not document transition targets for state-marker-only labels", () => {
      const rows = extractMarkdownStateRows();

      for (const row of rows) {
        if (TRANSITIONS.has(row.label)) continue;

        expect(
          row.nextLabels,
          `${row.label} is not a transition source and should not list next labels`,
        ).toEqual([]);
      }
    });

    it("stays aligned with the generated shell label metadata", () => {
      const generated = fs
        .readFileSync(PIPELINE_LABEL_DATA_PATH, "utf8")
        .replaceAll("\r\n", "\n");

      expect(generated).toBe(renderPipelineLabelShell());
    });

    it("stays aligned with the generated GitHub label catalogues", () => {
      const expected = renderLabelCatalogJson();
      const templateLabels = fs
        .readFileSync(TEMPLATE_LABELS_PATH, "utf8")
        .replaceAll("\r\n", "\n");
      const installedLabels = fs
        .readFileSync(INSTALLED_LABELS_PATH, "utf8")
        .replaceAll("\r\n", "\n");

      expect(templateLabels).toBe(expected);
      expect(installedLabels).toBe(expected);
    });
  });

  describe("object-type constraints", () => {
    it("rejects agent:implement on a PR", () => {
      const result = validateTransition([], { add: ["agent:implement"] }, "pr");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("cannot be applied to pr");
    });

    it("rejects agent:fix on an issue", () => {
      const result = validateTransition([], { add: ["agent:fix"] }, "issue");
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("cannot be applied to issue");
    });

    it("accepts agent:review on both issue and PR", () => {
      // agent:review is applied to a PR by agent-implement-prd.yml when a PRD
      // completes, so it must be valid on PRs as well as issues.
      expect(
        validateTransition([], { add: ["agent:review"] }, "issue").valid,
      ).toBe(true);
      expect(
        validateTransition([], { add: ["agent:review"] }, "pr").valid,
      ).toBe(true);
    });

    it("accepts agent:in-progress on both issue and PR", () => {
      expect(
        validateTransition([], { add: ["agent:in-progress"] }, "issue").valid,
      ).toBe(true);
      expect(
        validateTransition([], { add: ["agent:in-progress"] }, "pr").valid,
      ).toBe(true);
    });

    it("accepts Sandcastle on an issue", () => {
      const result = validateTransition([], { add: ["Sandcastle"] }, "issue");
      expect(result.valid).toBe(true);
    });

    it("rejects Sandcastle on a PR", () => {
      const result = validateTransition([], { add: ["Sandcastle"] }, "pr");
      expect(result.valid).toBe(false);
    });
  });

  describe("mutual exclusions", () => {
    it("rejects adding agent:in-progress when agent:blocked is present", () => {
      const result = validateTransition(
        ["agent:blocked"],
        { add: ["agent:in-progress"] },
        "issue",
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Mutual exclusion");
    });

    it("allows agent:in-progress after removing agent:blocked", () => {
      const result = validateTransition(
        ["agent:blocked"],
        { remove: ["agent:blocked"], add: ["agent:in-progress"] },
        "issue",
      );
      expect(result.valid).toBe(true);
    });

    it("rejects agent:fix and agent:merge coexisting", () => {
      const result = validateTransition(
        ["agent:fix"],
        { add: ["agent:merge"] },
        "pr",
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Mutual exclusion");
    });

    it("rejects agent:implement and agent:queued coexisting", () => {
      const result = validateTransition(
        ["agent:queued"],
        { add: ["agent:implement"] },
        "issue",
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Mutual exclusion");
    });

    it("allows agent:implement after removing agent:queued", () => {
      const result = validateTransition(
        ["agent:queued"],
        { remove: ["agent:queued"], add: ["agent:implement"] },
        "issue",
        "agent:queued",
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("transition legality", () => {
    it("accepts the full happy path: Sandcastle → review → implement → pr-open", () => {
      // Step 1: Sandcastle → agent:review
      const r1 = validateTransition(
        ["Sandcastle"],
        { remove: ["Sandcastle"], add: ["agent:review"] },
        "issue",
        "Sandcastle",
      );
      expect(r1.valid).toBe(true);

      // Step 2: agent:review → agent:implement
      const r2 = validateTransition(
        ["agent:review"],
        { remove: ["agent:review"], add: ["agent:implement"] },
        "issue",
        "agent:review",
      );
      expect(r2.valid).toBe(true);

      // Step 3: agent:implement → agent:pr-open
      const r3 = validateTransition(
        ["agent:implement"],
        { remove: ["agent:implement"], add: ["agent:pr-open"] },
        "issue",
        "agent:implement",
      );
      expect(r3.valid).toBe(true);
    });

    it("rejects an undeclared transition", () => {
      const result = validateTransition(
        ["Sandcastle"],
        { add: ["agent:pr-open"] },
        "issue",
        "Sandcastle",
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("not declared");
    });

    it("allows state markers regardless of trigger", () => {
      const result = validateTransition(
        ["Sandcastle"],
        { add: ["agent:in-progress"] },
        "issue",
        "Sandcastle",
      );
      expect(result.valid).toBe(true);
    });

    it("allows agent:blocked as state marker with any trigger", () => {
      const result = validateTransition(
        [],
        { add: ["agent:blocked"] },
        "issue",
        "agent:review",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts agent:queued → agent:implement promotion", () => {
      const result = validateTransition(
        ["agent:queued"],
        { remove: ["agent:queued"], add: ["agent:implement"] },
        "issue",
        "agent:queued",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts agent:implement-prd self-loop", () => {
      const result = validateTransition(
        ["agent:implement-prd"],
        { add: ["agent:implement-prd"] },
        "issue",
        "agent:implement-prd",
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("unknown labels", () => {
    it("warns about unknown labels but does not reject", () => {
      const result = validateTransition(
        [],
        { add: ["totally-unknown-label"] },
        "issue",
      );
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("Unknown label");
    });
  });

  describe("no-op / empty proposals", () => {
    it("accepts an empty proposal", () => {
      const result = validateTransition(["Sandcastle"], {}, "issue");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts remove-only proposals", () => {
      const result = validateTransition(
        ["agent:in-progress"],
        { remove: ["agent:in-progress"] },
        "issue",
      );
      expect(result.valid).toBe(true);
    });
  });
});
