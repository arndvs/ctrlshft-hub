import { existsSync } from "node:fs";
import { hostSessionStore } from "@ai-hero/sandcastle";

/**
 * Options for {@link waitForSessionFile}.
 */
export interface WaitForSessionFileOptions {
  /** How long to poll for the session file before giving up. Default: 30s. */
  readonly timeoutMs?: number;
  /** How often to check for the file. Default: 500ms. */
  readonly intervalMs?: number;
}

/**
 * Wait for a Claude Code session JSONL to appear on disk.
 *
 * The engine's two-phase extraction resumes the produce session via
 * `resumeSession: <id>`, and the Sandcastle library hard-requires the session
 * file to already exist at `~/.claude/projects/<encoded>/<id>.jsonl` before it
 * will resume. With the `noSandbox()` provider there is no bind-mount handle,
 * so Sandcastle's deterministic `transferSession` never runs — the file is
 * written only by Claude Code itself, asynchronously. This helper polls for
 * the file so the extraction does not race the flush.
 *
 * Returns `true` if the file appeared within the timeout, `false` otherwise.
 * Never throws — callers decide how to fall back when the file is absent.
 */
export async function waitForSessionFile(
  sessionId: string,
  options: WaitForSessionFileOptions = {}
): Promise<boolean> {
  const { timeoutMs = 30_000, intervalMs = 500 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (sessionFileExists(sessionId)) {
      return true;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }

  return sessionFileExists(sessionId);
}

/**
 * Check whether a session JSONL exists on disk for the given session id.
 *
 * Uses the same host session store layout the Sandcastle library resolves
 * (`~/.claude/projects/<encoded-cwd>/<id>.jsonl`), so the check matches the
 * path the resume logic will read.
 */
export function sessionFileExists(sessionId: string): boolean {
  const store = hostSessionStore(process.cwd());
  return existsSync(store.sessionFilePath(sessionId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}