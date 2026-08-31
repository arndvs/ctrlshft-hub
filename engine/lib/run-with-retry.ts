import {
  run,
  StructuredOutputError,
  type OutputObjectDefinition,
  type RunOptions,
  type RunResult,
} from "@ai-hero/sandcastle";
import { buildRetryFeedback } from "./retry-feedback.js";
import { waitForSessionFile } from "./wait-for-session-file.js";

/**
 * Options for {@link runWithRetry} — the standard `run()` options with `output`
 * required and a `maxAttempts` cap added.
 */
export interface RunWithRetryOptions<T> extends Omit<RunOptions, "output"> {
  /** Structured output to extract. Applied to the first call and every retry. */
  readonly output: OutputObjectDefinition<T>;
  /**
   * Total number of attempts (the first call plus retries) before giving up.
   * Default: 3 — one initial call and up to two resumed retries.
   */
  readonly maxAttempts?: number;
}

/**
 * Run an agent in a single call that both does the work and emits structured
 * output, retrying the *same session* if extraction fails.
 *
 * Use this for **side-effect-free** scripts where the structured output IS the
 * work (e.g. drafting a PR title/description, breaking a PRD into slices). For
 * these, splitting into a separate produce + extract pass (see
 * {@link import("./run-with-extraction").runWithExtraction}) buys nothing — the
 * drafting and the emission are the same act — so we keep one combined prompt:
 *
 * 1. Run `prompt`/`promptFile` WITH the `output` definition. On the happy path
 *    this is a single call.
 * 2. If `run()` throws {@link StructuredOutputError}, resume that same session
 *    (via `error.sessionId`) with a feedback message describing exactly what it
 *    emitted and why it failed. The session still holds all the agent's work, so
 *    it only needs to re-emit corrected output — nothing is re-done. Retry up to
 *    `maxAttempts` times total.
 *
 *    Before resuming, the wrapper waits for the failed session's JSONL to
 *    appear on disk (see {@link waitForSessionFile}). If it never appears, the
 *    retry runs FRESH (no `resumeSession`) with the same feedback prompt — the
 *    prompt is self-contained, so a fresh session can still correct the output.
 *
 * Resuming the failed session (rather than re-running from scratch) is only
 * possible because `StructuredOutputError` carries `sessionId` — see the host's
 * Sandcastle dependency (>= 0.5.12).
 *
 * Throws the final {@link StructuredOutputError} if every attempt fails, which
 * mirrors the pre-wrapper failure path.
 */
export async function runWithRetry<T>(
  options: RunWithRetryOptions<T>
): Promise<RunResult & { output: T }> {
  const { output, maxAttempts = 3, ...runOptions } = options;

  if (maxAttempts < 1) {
    throw new Error("runWithRetry: maxAttempts must be at least 1.");
  }

  let lastError: StructuredOutputError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!lastError) {
        // First attempt: the original prompt does the work AND emits output.
        return await run({ ...runOptions, output });
      }

      // Retry: resume the failed session and feed back what went wrong. The
      // session still holds everything the agent did, so it only re-emits.
      const sessionId = lastError.sessionId;
      if (!sessionId) {
        throw new Error(
          "runWithRetry: the failed run carried no sessionId, so it cannot be " +
            "resumed for a retry. Session capture must be enabled (Claude Code " +
            "provider with sessions written to the host)."
        );
      }

      // The Sandcastle library hard-requires the session JSONL to exist on
      // disk before it will resume. Wait briefly for it; if it never appears,
      // retry FRESH (no resumeSession) rather than failing the whole run — the
      // feedback prompt is self-contained, so a fresh session can still
      // correct the output.
      const sessionFileReady = await waitForSessionFile(sessionId);
      if (!sessionFileReady) {
        console.warn(
          `[runWithRetry] Session file for "${sessionId}" not found after wait — ` +
            "retrying with a fresh session instead of resuming.",
        );
      }

      // The retry uses an inline `prompt` (the feedback message), so drop
      // `promptArgs` — Sandcastle only allows promptArgs alongside a promptFile,
      // and the feedback prompt needs no substitution.
      const { promptArgs: _retryArgs, ...retryOptions } = runOptions;
      return await run({
        ...retryOptions,
        name: runOptions.name
          ? `${runOptions.name} (retry ${attempt - 1})`
          : undefined,
        promptFile: undefined,
        prompt: buildRetryFeedback(lastError, attempt, maxAttempts),
        // Only resume when the session file is on disk; omit the key entirely
        // when absent so the retry runs fresh.
        ...(sessionFileReady ? { resumeSession: sessionId } : {}),
        output,
      });
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
