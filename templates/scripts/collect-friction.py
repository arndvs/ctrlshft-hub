#!/usr/bin/env python3
"""
Extract mechanical friction signals from a completed session transcript.

Runs at session end, unconditionally, via a hook. Does NO attribution -- it does
not decide whether friction was the repo's fault or the agent's. That judgement
needs aggregate context (one instance never proves a name is unsearchable, nine
across six sessions does) and happens during weekly consolidation.

What this does: parse transcript -> segment episodes -> emit countable signals
with costs and locations. Cheap, deterministic, no model call.

Usage:
  collect-friction.py --transcript <path> --out-dir .friction [--harness claude-code]

Adapting to a harness: everything format-specific lives in normalize(). It maps
raw records to the Event shape documented there. Nothing downstream knows the
transcript format.
"""

import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

SCHEMA = 1

READ_TOOLS = {"read", "view", "cat", "open_file", "str_replace_editor_view"}
EDIT_TOOLS = {"write", "edit", "create_file", "str_replace", "apply_patch"}
SEARCH_TOOLS = {"grep", "search", "glob", "rg", "find", "codebase_search"}
EXEC_TOOLS = {"bash", "shell", "run_command", "terminal"}
FETCH_TOOLS = {"web_fetch", "fetch", "web_search", "browser"}

VERIFY_RE = re.compile(
    r"\b(pytest|jest|vitest|go test|cargo test|npm (run )?test|pnpm (run )?test|"
    r"yarn test|mvn test|gradle test|rspec|phpunit|tsc|mypy|ruff|eslint|"
    r"golangci-lint|clippy|make (test|check|lint))\b", re.I)
CI_CONFIG_RE = re.compile(r"(\.github/workflows/|\.gitlab-ci|Jenkinsfile|\.circleci/)", re.I)
INSTRUMENT_RE = re.compile(
    r"^\s*[+].*\b(print|console\.(log|error|debug)|fmt\.Print|System\.out\.print|"
    r"logger?\.(debug|info)|dbg!|pp )\b", re.M)

# Signals this script can decide mechanically. Semantic ones -- user correcting
# the agent's file choice, a sequence being re-derived -- need the attribution
# pass and are deliberately absent here.
MECHANICAL = {
    "wasted-reads", "search-churn", "orientation-cost", "truncated-read",
    "no-verification", "verification-not-found", "repair-loop",
    "flake-suspected", "instrumentation-added-to-diagnose",
    "external-doc-fetched", "output-volume-cost",
}


def normalize(raw_line, harness):
    """
    Map one raw transcript record to an Event, or None to skip.

    Event = {
      kind: user|assistant|tool_call|tool_result,
      ts:   ISO8601 string or None,
      tool: normalized lowercase tool name (tool_call only),
      path: file path the call targeted, if any,
      query: search query, if any,
      command: shell command text, if any,
      ok: bool (tool_result),
      truncated: bool (tool_result),
      size: int, result size in chars (tool_result),
      diff: str, patch text if the call carried one,
      text: str, message text for user/assistant turns,
    }

    ---- HARNESS SEAM ----
    Add a branch per harness. The default branch below assumes records already
    close to this shape; adjust rather than guessing at another product's format.
    """
    try:
        r = json.loads(raw_line)
    except json.JSONDecodeError:
        return None
    if not isinstance(r, dict):
        return None

    kind = r.get("type") or r.get("role") or r.get("kind")
    if kind in ("human", "user"):
        return {"kind": "user", "ts": r.get("timestamp") or r.get("ts"),
                "text": _text_of(r)}
    if kind in ("assistant", "ai"):
        return {"kind": "assistant", "ts": r.get("timestamp") or r.get("ts"),
                "text": _text_of(r)}

    if kind in ("tool_call", "tool_use", "function_call"):
        args = r.get("input") or r.get("args") or r.get("parameters") or {}
        if not isinstance(args, dict):
            args = {}
        return {
            "kind": "tool_call",
            "ts": r.get("timestamp") or r.get("ts"),
            "tool": (r.get("name") or r.get("tool") or "").lower(),
            "path": args.get("path") or args.get("file_path") or args.get("filename"),
            "query": args.get("query") or args.get("pattern") or args.get("regex"),
            "command": args.get("command") or args.get("cmd"),
            "diff": args.get("new_str") or args.get("patch") or args.get("content"),
        }

    if kind in ("tool_result", "tool_response", "function_result"):
        content = r.get("content") or r.get("output") or r.get("result") or ""
        if not isinstance(content, str):
            content = json.dumps(content)
        return {
            "kind": "tool_result",
            "ts": r.get("timestamp") or r.get("ts"),
            "ok": not bool(r.get("is_error") or r.get("error")),
            "truncated": bool(r.get("truncated")) or "truncated" in content[-400:].lower(),
            "size": len(content),
        }
    return None


def _text_of(r):
    c = r.get("content") or r.get("text") or ""
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict))
    return ""


def classify(tool):
    for group, name in ((READ_TOOLS, "read"), (EDIT_TOOLS, "edit"),
                        (SEARCH_TOOLS, "search"), (EXEC_TOOLS, "exec"),
                        (FETCH_TOOLS, "fetch")):
        if tool in group or any(tool.endswith(t) or t in tool for t in group):
            return name
    return "other"


def segment(events):
    """
    Split into episodes at user turns.

    Approximate by design: a brief user turn following agent activity is usually
    a correction inside the same objective ("no, the other file"), not a new one,
    so it does not open an episode. The threshold is deliberately tight -- under
    merging is cheaper than over merging, because a merged episode hides one
    task's friction inside another's counts.

    Ambiguous boundaries are marked so the attribution pass can merge or split.
    """
    CORRECTION_MAX_CHARS = 60

    episodes, cur, ambiguous = [], [], False
    for ev in events:
        if ev["kind"] == "user" and cur:
            text = (ev.get("text") or "").strip()
            has_activity = any(e["kind"] == "tool_call" for e in cur)
            if len(text) <= CORRECTION_MAX_CHARS and has_activity:
                cur.append(ev)          # treat as a correction, stay in episode
                continue
            episodes.append((cur, ambiguous))
            # A boundary is ambiguous when the new turn is short enough that it
            # might have been a correction rather than a new objective.
            ambiguous = len(text) <= CORRECTION_MAX_CHARS * 2
            cur = [ev]
        else:
            cur.append(ev)
    if cur:
        episodes.append((cur, ambiguous))
    return [(e, amb) for e, amb in episodes
            if any(x["kind"] == "tool_call" for x in e)]


def pair_calls(episode):
    """Zip each tool_call with the tool_result that followed it."""
    out, pending = [], None
    for ev in episode:
        if ev["kind"] == "tool_call":
            if pending:
                out.append((pending, None))
            pending = ev
        elif ev["kind"] == "tool_result" and pending:
            out.append((pending, ev))
            pending = None
    if pending:
        out.append((pending, None))
    return out


def zero_cost():
    return {"tool_calls": 0, "files_read_unused": 0, "turns": 0, "tokens_estimate": 0}


def analyse(episode, idx):
    """Emit mechanical signals for one episode."""
    calls = pair_calls(episode)
    signals = []

    reads, edits, searches, execs, fetches = [], [], [], [], []
    truncated_paths = []
    big_outputs = []

    for call, result in calls:
        c = classify(call.get("tool", ""))
        if c == "read" and call.get("path"):
            reads.append(call["path"])
            if result and result.get("truncated"):
                truncated_paths.append(call["path"])
        elif c == "edit" and call.get("path"):
            edits.append((call["path"], call.get("diff") or ""))
        elif c == "search" and call.get("query"):
            searches.append(call["query"])
        elif c == "exec" and call.get("command"):
            execs.append((call["command"], result))
        elif c == "fetch":
            fetches.append(call.get("query") or call.get("path") or "")
        if result and result.get("size", 0) > 40000:
            big_outputs.append((call.get("tool"), result["size"]))

    edited_paths = {p for p, _ in edits}
    total_calls = len(calls)

    def sig(lens, name, fingerprint, cost, statement, conf="medium"):
        signals.append({
            "lens": lens, "signal": name, "disposition": "observed",
            "fingerprint": fingerprint, "cost": cost,
            "statement": statement, "confidence": conf,
        })

    def clean(lens, name, fingerprint=None):
        signals.append({
            "lens": lens, "signal": name, "disposition": "clean",
            "fingerprint": fingerprint, "cost": zero_cost(),
            "statement": None, "confidence": "medium",
        })

    # wasted-reads: read once, never edited, never re-read
    counts = defaultdict(int)
    for p in reads:
        counts[p] += 1
    unused = [p for p, n in counts.items() if n == 1 and p not in edited_paths]
    if edits and len(unused) >= 3:
        sig("structure", "wasted-reads", f"structure:{_common_dir(unused)}:exploration",
            {**zero_cost(), "tool_calls": len(unused),
             "files_read_unused": len(unused), "tokens_estimate": len(unused) * 2500},
            f"{len(unused)} files were opened once and neither edited nor revisited "
            f"before the change landed elsewhere.")
    elif edits:
        clean("structure", "wasted-reads")

    # search-churn: 3+ distinct queries with no edit between
    if len(set(searches)) >= 3:
        sig("naming", "search-churn", f"naming:{_common_dir(reads) or '.'}:search",
            {**zero_cost(), "tool_calls": len(searches), "turns": 1,
             "tokens_estimate": len(searches) * 1800},
            f"{len(set(searches))} distinct search terms were tried before the "
            f"target was located.")
    elif searches:
        clean("naming", "search-churn")

    # orientation-cost: calls before first mutation
    first_edit = next((i for i, (c, _) in enumerate(calls)
                       if classify(c.get("tool", "")) == "edit"), None)
    if first_edit is not None:
        if first_edit >= 12:
            sig("orientation", "orientation-cost", "orientation:.:session-start",
                {**zero_cost(), "tool_calls": first_edit,
                 "tokens_estimate": first_edit * 2000},
                f"{first_edit} tool calls preceded the first change.")
        else:
            clean("orientation", "orientation-cost", "orientation:.:session-start")

    for p in set(truncated_paths):
        sig("structure", "truncated-read", f"structure:{p}:size",
            {**zero_cost(), "tool_calls": 1, "tokens_estimate": 8000},
            "A file read was truncated, so the agent worked from a partial view.",
            conf="high")

    # verification
    verified = [c for c, _ in execs if VERIFY_RE.search(c)]
    if edits and not verified:
        sig("verification", "no-verification", "verification:.:episode",
            {**zero_cost(), "turns": 1},
            "The episode ended with changes made and no test, build, lint or "
            "type check run.", conf="high")
    elif verified:
        clean("verification", "no-verification", "verification:.:episode")

    if not verified and any(CI_CONFIG_RE.search(p) for p in reads):
        sig("verification", "verification-not-found", "verification:.:commands",
            {**zero_cost(), "tool_calls": 2, "tokens_estimate": 6000},
            "CI configuration was read, which usually means the local "
            "verification command was not documented anywhere obvious.")

    # repair-loop: same verification command run 3+ times, all failing
    runs = defaultdict(list)
    for cmd, res in execs:
        if VERIFY_RE.search(cmd):
            runs[cmd.strip()].append(res)
    for cmd, results in runs.items():
        oks = [bool(r and r.get("ok")) for r in results]
        if len(results) >= 3 and not any(oks):
            sig("verification", "repair-loop", "verification:.:feedback",
                {**zero_cost(), "tool_calls": len(results), "turns": len(results),
                 "tokens_estimate": len(results) * 4000},
                f"The same check was run {len(results)} times without ever "
                f"passing, suggesting the failure was not informative enough to act on.")
        if len(oks) >= 2 and oks[-1] and not oks[-2] and not edits:
            sig("verification", "flake-suspected", "verification:.:flake",
                {**zero_cost(), "tool_calls": 2, "turns": 1, "tokens_estimate": 5000},
                "A check failed then passed with no intervening change.", conf="high")

    # instrumentation added to diagnose
    for path, diff in edits:
        if diff and INSTRUMENT_RE.search(diff):
            sig("logging", "instrumentation-added-to-diagnose", f"logging:{path}:diagnostics",
                {**zero_cost(), "tool_calls": 2, "turns": 1, "tokens_estimate": 6000},
                "Diagnostic output was added to the code to understand runtime "
                "behaviour that existing logging did not expose.", conf="high")
            break

    for tool, size in big_outputs[:2]:
        sig("logging", "output-volume-cost", "logging:.:volume",
            {**zero_cost(), "tool_calls": 1, "tokens_estimate": size // 4},
            "A single command returned enough output to consume a large share "
            "of the working context.")

    if fetches:
        sig("assets", "external-doc-fetched", "assets:ai_docs:vendoring",
            {**zero_cost(), "tool_calls": len(fetches),
             "tokens_estimate": len(fetches) * 5000},
            f"{len(fetches)} external documentation fetches were made during the task.")

    for s in signals:
        s["episode"] = idx
        s["total_episode_calls"] = total_calls
    return signals


def _common_dir(paths):
    paths = [p for p in paths if p]
    if not paths:
        return "."
    parts = [pathlib.PurePosixPath(p).parts[:-1] for p in paths]
    common = []
    for group in zip(*parts):
        if len(set(group)) == 1:
            common.append(group[0])
        else:
            break
    return "/".join(common) if common else "."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--transcript", required=True)
    ap.add_argument("--out-dir", default=".friction")
    ap.add_argument("--harness", default="unknown")
    args = ap.parse_args()

    src = pathlib.Path(args.transcript)
    if not src.exists():
        print(f"error: transcript not found: {src}", file=sys.stderr)
        return 1

    events = []
    for line in src.read_text(errors="replace").splitlines():
        if line.strip():
            ev = normalize(line, args.harness)
            if ev:
                events.append(ev)

    if not any(e["kind"] == "tool_call" for e in events):
        # No tool events means this harness did not record them, or nothing
        # happened. Either way the absence of signals is not evidence of a clean
        # repo, so emit nothing rather than a misleading clean sheet.
        print("note: no tool events found; nothing to record", file=sys.stderr)
        return 0

    episodes = segment(events)
    session_ref = hashlib.sha256(src.read_bytes()).hexdigest()[:6]
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    records = []
    for i, (ep, ambiguous) in enumerate(episodes, 1):
        for s in analyse(ep, i):
            records.append({
                "schema": SCHEMA, "recorded_at": now, "session_ref": session_ref,
                "harness": args.harness, "attribution": "pending",
                "episode_boundary": "ambiguous" if ambiguous else "clear", **s,
            })

    out_dir = pathlib.Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{now[:10]}-{session_ref}.jsonl"
    out.write_text("".join(json.dumps(r) + "\n" for r in records))

    observed = sum(1 for r in records if r["disposition"] == "observed")
    print(f"episodes={len(episodes)} records={len(records)} observed={observed} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())