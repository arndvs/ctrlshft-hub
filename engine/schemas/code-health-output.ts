import { z } from "zod";

const FindingSchema = z.object({
  fingerprint: z.string().min(1),
  lens: z.string().min(1),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
  title: z.string().min(1).max(256),
  body: z.string().min(1),
  /** Paths the implementer is permitted to modify. Enforced in CI. */
  allowlist: z.array(z.string().min(1)).min(1),
});

const ProposedSchema = z.object({
  status: z.literal("proposed"),
  findings: z.array(FindingSchema).min(1).max(5),
});

const SkippedSchema = z.object({
  status: z.literal("skipped"),
  reason: z.string().min(1),
});

const ErrorSchema = z.object({
  status: z.literal("error"),
  reason: z.string().min(1),
});

export const CodeHealthOutput = z.discriminatedUnion("status", [
  ProposedSchema,
  SkippedSchema,
  ErrorSchema,
]);

export type CodeHealthOutput = z.infer<typeof CodeHealthOutput>;