import { describe, it, expect } from "vitest";
import { scoreComment, FORCED_CONFIRM_PATTERNS } from "./score-comment.js";
import type { PrComment } from "./types.js";

describe("scoreComment", () => {
  describe("tier assignment", () => {
    it("assigns auto tier for score >= 75", () => {
      const comment: PrComment = {
        path: "src/utils.ts",
        line: 42,
        body: "Add missing `await` before `fetchData()` on line 42.",
        filesAffected: 1,
        linesAffected: 1,
      };

      const result = scoreComment(comment);

      expect(result.tier).toBe("auto");
      expect(result.score).toBeGreaterThanOrEqual(75);
    });

    it("assigns hitl tier for vague comments scoring < 40", () => {
      const comment: PrComment = {
        path: "src/utils.ts",
        line: null,
        body: "You might want to consider refactoring this module to perhaps use a different pattern in some cases.",
        crossFile: true,
        filesAffected: 4,
        linesAffected: 50,
      };

      const result = scoreComment(comment);

      expect(result.tier).toBe("hitl");
      expect(result.score).toBeLessThan(40);
    });

    it("assigns confirm tier for mid-range scores", () => {
      const comment: PrComment = {
        path: "src/lib/api.ts",
        line: 10,
        body: "Rename getData to fetchUserData for clarity.",
        crossFile: true,
        filesAffected: 3,
        linesAffected: 15,
      };

      const result = scoreComment(comment);

      // base(50) + specific(20) + mechanical(25) + no-api-change(10) + shared-util(-20) + cross-file(-15) = 70
      expect(result.tier).toBe("confirm");
      expect(result.score).toBeGreaterThanOrEqual(40);
      expect(result.score).toBeLessThan(75);
    });
  });

  describe("signal: specific comment (+20)", () => {
    it("applies +20 when comment cites exact line and change", () => {
      const comment: PrComment = {
        path: "src/foo.ts",
        line: 10,
        body: "Change `let` to `const` on line 10 since the variable is never reassigned.",
      };

      const result = scoreComment(comment);
      const signal = result.signals.find((s) => s.label === "specific");

      expect(signal).toBeDefined();
      expect(signal!.delta).toBe(20);
    });

    it("does not apply specific signal when line is null", () => {
      const comment: PrComment = {
        path: "src/foo.ts",
        line: null,
        body: "This code could be better.",
      };

      const result = scoreComment(comment);
      const signal = result.signals.find((s) => s.label === "specific");

      expect(signal).toBeUndefined();
    });
  });

  describe("signal: mechanical fix (+25)", () => {
    it("applies +25 for rename suggestions", () => {
      const comment: PrComment = { path: "a.ts", line: 5, body: "Rename `foo` to `bar`." };
      const result = scoreComment(comment);
      const signal = result.signals.find((s) => s.label === "mechanical");

      expect(signal).toBeDefined();
      expect(signal!.delta).toBe(25);
    });

    it("applies +25 for add guard suggestions", () => {
      const comment: PrComment = { path: "a.ts", line: 5, body: "Add a null guard before accessing `.name`." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "mechanical")).toBeDefined();
    });

    it("applies +25 for add type suggestions", () => {
      const comment: PrComment = { path: "a.ts", line: 5, body: "Add type annotation `string` to the parameter." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "mechanical")).toBeDefined();
    });

    it("applies +25 for fix typo suggestions", () => {
      const comment: PrComment = { path: "a.ts", line: 5, body: "Fix typo: `recieve` → `receive`." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "mechanical")).toBeDefined();
    });

    it("applies +25 for missing await suggestions", () => {
      const comment: PrComment = { path: "a.ts", line: 5, body: "Add missing `await` before this async call." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "mechanical")).toBeDefined();
    });
  });

  describe("signal: small scope (+15)", () => {
    it("does not apply when affected file and line counts are unknown", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "fix this" };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "small-scope")).toBeUndefined();
    });

    it("applies +15 when filesAffected <= 1 and linesAffected <= 10", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "fix this", filesAffected: 1, linesAffected: 5 };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "small-scope")?.delta).toBe(15);
    });

    it("does not apply when filesAffected > 1", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "fix this", filesAffected: 2, linesAffected: 5 };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "small-scope")).toBeUndefined();
    });
  });

  describe("signal: no public API change (+10)", () => {
    it("applies +10 when body does not mention exports or public API", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Use const instead of let." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "no-api-change")?.delta).toBe(10);
    });

    it("does not apply when body mentions export changes", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Change the exported type signature." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "no-api-change")).toBeUndefined();
    });
  });

  describe("signal: concrete suggestion (+15)", () => {
    it("applies +15 when comment contains code block", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Replace with:\n```ts\nconst x = 1;\n```" };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "concrete-suggestion")?.delta).toBe(15);
    });
  });

  describe("signal: vague language (-25)", () => {
    it("applies -25 for 'consider'", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Consider using a different approach." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "vague")?.delta).toBe(-25);
    });

    it("applies -25 for 'might want to'", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "You might want to restructure this." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "vague")).toBeDefined();
    });

    it("applies -25 for 'perhaps'", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Perhaps this should be different." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "vague")).toBeDefined();
    });

    it("applies -25 for 'in some cases'", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "In some cases this may fail." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "vague")).toBeDefined();
    });
  });

  describe("signal: cross-file (-15)", () => {
    it("applies -15 when crossFile is true", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "fix", crossFile: true };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "cross-file")?.delta).toBe(-15);
    });
  });

  describe("signal: shared util (-20)", () => {
    it("applies -20 when path looks like a shared utility", () => {
      const comment: PrComment = { path: "src/lib/utils.ts", line: 1, body: "fix this" };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "shared-util")?.delta).toBe(-20);
    });

    it("applies -20 for hook files", () => {
      const comment: PrComment = { path: "src/hooks/useAuth.ts", line: 1, body: "fix this" };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "shared-util")).toBeDefined();
    });
  });

  describe("signal: test modification (-20)", () => {
    it("applies -20 when path is a test file", () => {
      const comment: PrComment = { path: "src/utils.test.ts", line: 1, body: "fix assertion" };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "test-modification")?.delta).toBe(-20);
    });
  });

  describe("signal: error handling change (-15)", () => {
    it("applies -15 when body mentions error handling", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Change the catch block to rethrow instead of swallowing." };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "error-handling")?.delta).toBe(-15);
    });
  });

  describe("signal: stale context (-10)", () => {
    it("applies -10 when isStale is true", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "fix", isStale: true };
      const result = scoreComment(comment);

      expect(result.signals.find((s) => s.label === "stale")?.delta).toBe(-10);
    });
  });

  describe("forced-confirm keywords", () => {
    it("floors to confirm tier even when arithmetic would yield auto", () => {
      const comment: PrComment = {
        path: "src/utils.ts",
        line: 42,
        body: "Refactor this function to use early returns. Change `let` to `const`.",
        filesAffected: 1,
        linesAffected: 1,
      };

      const result = scoreComment(comment);

      expect(result.tier).toBe("confirm");
      expect(result.score).toBeGreaterThanOrEqual(40);
    });

    it("detects 'normalize' as forced-confirm keyword", () => {
      const comment: PrComment = { path: "a.ts", line: 1, body: "Normalize the data before saving." };
      const result = scoreComment(comment);

      expect(result.tier).not.toBe("auto");
    });
  });

  describe("forced-confirm keyword pin (sync with review-pr-copilot skill)", () => {
    it("pins the exact forced-confirm keyword set", () => {
      // If you change FORCED_CONFIRM_PATTERNS, update this list AND the Forced-Confirm
      // keyword list in skills/review-pr-copilot/SKILL.md so prose and code stay in sync.
      expect(FORCED_CONFIRM_PATTERNS.map((r) => r.source)).toEqual([
        "\\brefactor\\b",
        "\\balign\\b",
        "\\bnormalize\\b",
        "\\bstandardize\\b",
        "\\bsemantics?\\b",
        "\\bbehaviou?rs?\\b",
        "\\bcontract\\b",
        "\\bsignature\\b",
        "\\breturn[\\s-]type\\b",
        "\\bparameter[\\s-]type\\b",
        "\\berror model\\b",
      ]);
      // Pin flags too — a dropped case-insensitive flag would slip past a source-only check.
      expect(FORCED_CONFIRM_PATTERNS.every((r) => r.flags === "i")).toBe(true);
    });

    it.each([
      "refactor",
      "align",
      "normalize",
      "standardize",
      "semantics",
      "behavior",
      "behaviour",
      "contract",
      "signature",
      "return type",
      "parameter type",
      "error model",
    ])("caps an otherwise-auto comment to confirm when it mentions '%s'", (keyword) => {
      const comment: PrComment = {
        path: "src/foo.ts",
        line: 5,
        body: `Rename foo to bar to address the ${keyword} here.`,
        filesAffected: 1,
        linesAffected: 1,
      };

      const result = scoreComment(comment);

      expect(result.score).toBeGreaterThanOrEqual(75);
      expect(result.tier).toBe("confirm");
    });
  });

  describe("signal set pin", () => {
    it("emits exactly the canonical positive signals", () => {
      const comment: PrComment = {
        path: "src/foo.ts",
        line: 10,
        body: "Add missing `await`; change `let` to `const`.",
        filesAffected: 1,
        linesAffected: 1,
      };

      const labels = scoreComment(comment).signals.map((s) => s.label).sort();

      expect(labels).toEqual(["concrete-suggestion", "mechanical", "no-api-change", "small-scope", "specific"]);
    });

    it("emits exactly the canonical negative signals (no local-only test-coverage signal in CI)", () => {
      const comment: PrComment = {
        path: "src/lib/api.test.ts",
        line: null,
        body: "You might want to consider whether this interface change could break error handling in some cases.",
        crossFile: true,
        isStale: true,
        filesAffected: 4,
        linesAffected: 50,
      };

      const labels = scoreComment(comment).signals.map((s) => s.label).sort();

      expect(labels).toEqual(["cross-file", "error-handling", "shared-util", "stale", "test-modification", "vague"]);
    });
  });

  describe("score clamping", () => {
    it("never returns score below 0", () => {
      const comment: PrComment = {
        path: "src/hooks/useShared.ts",
        line: null,
        body: "You might want to consider perhaps restructuring this in some cases. Change error handling.",
        crossFile: true,
        isStale: true,
        filesAffected: 5,
        linesAffected: 100,
      };

      const result = scoreComment(comment);

      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("never returns score above 100", () => {
      const comment: PrComment = {
        path: "src/foo.ts",
        line: 42,
        body: "Add missing `await` on line 42.\n```ts\nawait fetchData();\n```",
        filesAffected: 1,
        linesAffected: 1,
      };

      const result = scoreComment(comment);

      expect(result.score).toBeLessThanOrEqual(100);
    });
  });
});
