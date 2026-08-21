#!/usr/bin/env python3
"""
Consolidate friction observations into ranked candidate findings.

Reads .friction/*.jsonl (one file per session), groups by fingerprint, and emits
candidates the lens agent can write up. Ranking is by measured cost rather than
by severity guess -- that is the point of collecting observations at all.

Also detects two things a static audit cannot:
  resolved    -- friction that measurably stopped happening
  regressions -- fingerprints marked fixed that started recurring

Usage:
  consolidate-friction.py --store .friction \
      --known "$KNOWN_FINDINGS_FILE" \
      --out "$RUNNER_TEMP/friction_candidates.json"
"""

import argparse
import json
import pathlib
import sys
from collections import defaultdict
from datetime import datetime

# Three occurrences make a pattern; two distinct sessions stops one bad
# afternoon from generating findings on its own.
MIN_OBSERVED = 3
MIN_SESSIONS = 2

# Secondary observations are deliberate defect notes rather than noisy friction
# counts, so the bar is lower -- but two independent reporters are still required
# so one workflow's opinion never becomes a finding on its own.
MIN_OBSERVED_SECONDARY = 2
MIN_SOURCES_SECONDARY = 2

# Hard cap. Observations must never crowd out measured evidence.
MAX_OBSERVATIONS = 5

# A clean streak this long, spanning at least two sessions, is treated as
# evidence the underlying problem is gone.
RESOLVED_STREAK = 5

COST_KEYS = ("tool_calls", "files_read_unused", "turns", "tokens_estimate")

# Compaction is deliberately not implemented -- growth rate is unknown until the
# store has run for a while, and a scheme designed before there is data compacts
# the wrong things. Warn instead, and build compaction when the warning fires.
STORE_WARN_FILES = 300
STORE_WARN_BYTES = 20 * 1024 * 1024

# Rough weighting so a single expensive episode can outrank many cheap ones.
# Tokens dominate real cost, so they carry the weight; the rest are tie-breakers.
COST_WEIGHTS = {
    "tokens_estimate": 1.0,
    "tool_calls": 400.0,
    "files_read_unused": 600.0,
    "turns": 1200.0,
}


def load_records(store: pathlib.Path):
    """Read every observation, skipping malformed lines loudly."""
    records, skipped = [], 0
    files = sorted(p for p in store.glob("*.jsonl") if p.is_file())
    for path in files:
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                print(f"warning: {path.name}:{lineno} is not valid JSON", file=sys.stderr)
                continue
            if not isinstance(rec, dict) or "disposition" not in rec:
                skipped += 1
                print(f"warning: {path.name}:{lineno} missing disposition", file=sys.stderr)
                continue
            records.append(rec)
    return records, len(files), skipped


def load_known(path):
    """Fingerprints already filed, fixed, or declined."""
    if not path:
        return set(), set()
    p = pathlib.Path(path)
    if not p.exists():
        print(f"warning: known-findings file {path} not found; no suppression",
              file=sys.stderr)
        return set(), set()
    data = json.loads(p.read_text())
    suppress = set(data.get("open", [])) | set(data.get("declined", []))
    fixed = set(data.get("fixed", []))
    # Fixed items are suppressed too, but tracked separately so recurrence after
    # a fix can be reported as a regression rather than a fresh finding.
    return suppress | fixed, fixed


def weighted_cost(cost):
    return sum(COST_WEIGHTS[k] * cost.get(k, 0) for k in COST_WEIGHTS)


def trend(records):
    """
    Friction cost per episode, by week.

    The one number that says whether this whole system is working. If the audits
    and the implementer are doing their job it declines. Unlike a self-reported
    KPI it cannot be improved except by actually fixing things -- and unlike
    'attempts', driving it down does not reward accepting worse output.
    """
    weeks = defaultdict(lambda: {"cost": 0.0, "episodes": set(), "observed": 0})
    for r in records:
        when = r.get("recorded_at") or ""
        if len(when) < 10:
            continue
        try:
            iso = datetime.strptime(when[:10], "%Y-%m-%d").isocalendar()
        except ValueError:
            continue
        key = f"{iso[0]}-W{iso[1]:02d}"
        w = weeks[key]
        w["episodes"].add((r.get("session_ref"), r.get("episode")))
        if r.get("disposition") == "observed":
            w["observed"] += 1
            w["cost"] += weighted_cost(r.get("cost") or {})

    out = []
    for key in sorted(weeks):
        w = weeks[key]
        n = len(w["episodes"]) or 1
        out.append({
            "week": key,
            "episodes": len(w["episodes"]),
            "observed_signals": w["observed"],
            "cost_per_episode": round(w["cost"] / n, 1),
        })
    return out


def store_health(store: pathlib.Path, session_files: int):
    """Warn on growth rather than silently compacting."""
    total = sum(p.stat().st_size for p in store.glob("*.jsonl") if p.is_file()) \
        if store.is_dir() else 0
    warn = None
    if session_files >= STORE_WARN_FILES or total >= STORE_WARN_BYTES:
        warn = (f"friction store has {session_files} files / {total // 1024}KB; "
                f"time to compact older records into aggregates")
        print(f"::warning::{warn}", file=sys.stderr)
    return {"files": session_files, "bytes": total, "warning": warn}


def consolidate(records):
    """
    Group into two tracks.

    Measured friction carries a cost and is ranked by it. Secondary observations
    -- defects noted by another agent while reading for its own purpose -- carry
    no cost by design, so ranking them on the same axis buries them permanently
    at the bottom. They get their own track and their own threshold instead.

    Giving them a nominal cost was the alternative and is worse: it would launder
    an opinion into a measurement and let opinions outrank evidence.
    """
    groups = defaultdict(lambda: {
        "lens": None,
        "observed": [],
        "clean": [],
        "sessions_observed": set(),
        "sessions_clean": set(),
        "cost": {k: 0 for k in COST_KEYS},
        "statements": [],
        "first_seen": None,
        "last_seen": None,
        "sources": set(),
    })

    not_applicable = 0

    for rec in records:
        disp = rec.get("disposition")
        if disp == "not-applicable":
            not_applicable += 1
            continue
        fp = rec.get("fingerprint")
        if not fp:
            # Unlocatable friction still counted in totals but never promoted.
            continue
        if disp not in ("observed", "clean"):
            continue

        g = groups[fp]
        g["lens"] = g["lens"] or rec.get("lens")
        g["sources"].add(rec.get("source") or "friction")
        when = rec.get("recorded_at")
        session = rec.get("session_ref") or "unknown"

        if disp == "observed":
            g["observed"].append(rec)
            g["sessions_observed"].add(session)
            for k in COST_KEYS:
                g["cost"][k] += int(rec.get("cost", {}).get(k, 0) or 0)
            stmt = rec.get("statement")
            if stmt and stmt not in g["statements"]:
                g["statements"].append(stmt)
        else:
            g["clean"].append(rec)
            g["sessions_clean"].add(session)

        if when:
            if g["first_seen"] is None or when < g["first_seen"]:
                g["first_seen"] = when
            if g["last_seen"] is None or when > g["last_seen"]:
                g["last_seen"] = when

    return groups, not_applicable


def clean_streak(group):
    """Consecutive clean observations at the tail, by recording time."""
    timeline = sorted(
        [(r.get("recorded_at") or "", "observed") for r in group["observed"]]
        + [(r.get("recorded_at") or "", "clean") for r in group["clean"]]
    )
    streak, sessions = 0, set()
    for _, disp in reversed(timeline):
        if disp != "clean":
            break
        streak += 1
    if streak:
        tail = sorted(group["clean"], key=lambda r: r.get("recorded_at") or "")[-streak:]
        sessions = {r.get("session_ref") for r in tail}
    return streak, len(sessions)


def build(groups, suppress, fixed, not_applicable, session_files, skipped,
          trend_rows=None, health=None):
    candidates, observations, resolved, regressions = [], [], [], []
    below_threshold = suppressed = 0

    for fp, g in groups.items():
        observed = len(g["observed"])
        clean = len(g["clean"])
        streak, streak_sessions = clean_streak(g)

        # Resolution is reported even for suppressed fingerprints -- knowing a
        # filed issue can be closed with evidence is worth more than the
        # candidate would have been.
        if observed and streak >= RESOLVED_STREAK and streak_sessions >= MIN_SESSIONS:
            resolved.append({
                "fingerprint": fp,
                "lens": g["lens"],
                "clean_streak": streak,
                "prior_observed": observed,
                "last_seen": g["last_seen"],
            })
            continue

        if fp in fixed and observed:
            regressions.append({
                "fingerprint": fp,
                "lens": g["lens"],
                "observed_since_fix": observed,
                "distinct_sessions": len(g["sessions_observed"]),
                "statements": g["statements"][:3],
            })
            continue

        if fp in suppress:
            suppressed += 1
            continue

        # Fingerprints seen only via secondary observation have no measured cost,
        # so they take the observation track. Anything with real friction behind
        # it stays a candidate even if an observation also mentioned it.
        observation_only = g["sources"] and g["sources"] <= {"secondary-observation"}

        if observation_only:
            if observed >= MIN_OBSERVED_SECONDARY and \
                    len(g["sessions_observed"]) >= MIN_SOURCES_SECONDARY:
                observations.append({
                    "fingerprint": fp,
                    "lens": g["lens"],
                    "observed_count": observed,
                    "distinct_reporters": len(g["sessions_observed"]),
                    "first_seen": g["first_seen"],
                    "last_seen": g["last_seen"],
                    "statements": g["statements"][:3],
                })
            else:
                below_threshold += 1
            continue

        if observed < MIN_OBSERVED or len(g["sessions_observed"]) < MIN_SESSIONS:
            below_threshold += 1
            continue

        total = observed + clean
        candidates.append({
            "fingerprint": fp,
            "lens": g["lens"],
            "observed_count": observed,
            "clean_count": clean,
            "friction_rate": round(observed / total, 2) if total else None,
            "distinct_sessions": len(g["sessions_observed"]),
            "total_cost": g["cost"],
            "weighted_cost": round(weighted_cost(g["cost"]), 1),
            "first_seen": g["first_seen"],
            "last_seen": g["last_seen"],
            "statements": g["statements"][:3],
        })

    candidates.sort(key=lambda c: c["weighted_cost"], reverse=True)
    regressions.sort(key=lambda r: r["observed_since_fix"], reverse=True)
    observations.sort(
        key=lambda o: (o["distinct_reporters"], o["observed_count"]), reverse=True)
    if len(observations) > MAX_OBSERVATIONS:
        below_threshold += len(observations) - MAX_OBSERVATIONS
        observations = observations[:MAX_OBSERVATIONS]

    return {
        "schema": 1,
        "candidates": candidates,
        "observations": observations,
        "resolved": resolved,
        "regressions": regressions,
        "below_threshold": below_threshold,
        "suppressed": suppressed,
        "not_applicable_records": not_applicable,
        "sessions_scanned": session_files,
        "malformed_records": skipped,
        "trend": trend_rows or [],
        "store_health": health or {"files": 0, "bytes": 0, "warning": None},
        "thresholds": {
            "min_observed": MIN_OBSERVED,
            "min_sessions": MIN_SESSIONS,
            "resolved_streak": RESOLVED_STREAK,
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default=".friction")
    ap.add_argument("--known", default=None)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    store = pathlib.Path(args.store)
    if not store.is_dir():
        # An absent store is a legitimate state, not an error -- it just means
        # nothing has collected friction yet. Emit an empty result so the
        # caller sees a well-formed file rather than having to guess.
        print(f"note: no friction store at {store}; emitting empty result",
              file=sys.stderr)
        pathlib.Path(args.out).write_text(json.dumps(
            build({}, set(), set(), 0, 0, 0), indent=2) + "\n")
        return 0

    records, session_files, skipped = load_records(store)
    suppress, fixed = load_known(args.known)
    groups, not_applicable = consolidate(records)
    result = build(groups, suppress, fixed, not_applicable, session_files, skipped,
                   trend_rows=trend(records), health=store_health(store, session_files))

    pathlib.Path(args.out).write_text(json.dumps(result, indent=2) + "\n")

    print(f"sessions={session_files} records={len(records)} "
          f"candidates={len(result['candidates'])} "
          f"observations={len(result['observations'])} "
          f"resolved={len(result['resolved'])} "
          f"regressions={len(result['regressions'])} "
          f"below_threshold={result['below_threshold']} "
          f"suppressed={result['suppressed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())