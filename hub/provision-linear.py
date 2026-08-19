#!/usr/bin/env python3
"""Provision GitHub PRD issues into Linear CTRL team (linked, source-of-truth stays in GitHub).

Uses a bash helper script (linear-create.sh) to avoid Windows cmd.exe quoting hell.
"""

import json
import os
import subprocess
import sys
import tempfile

TEAM_ID = "e87b394c-97b7-4b6b-82af-fb677db76996"  # CtrlShftDotfiles (CTRL)
STATE_TODO = "4e9eecd1-50cd-4a59-92ac-aa25b13f1ea0"  # Todo (unstarted)

HERE = os.path.dirname(os.path.abspath(__file__))


def to_bash_path(p: str) -> str:
    """Convert a Windows path (C:\\Users\\...) to the form the bash invoked by
    Python understands. Python's subprocess bash runs in WSL mode (/mnt/c/...),
    not Git-Bash mode (/c/...)."""
    if os.name == "nt" and len(p) > 2 and p[1] == ":":
        return "/mnt/" + p[0].lower() + p[2:].replace("\\", "/")
    return p


HELPER = to_bash_path(HERE) + "/linear-create.sh"


def create_issue(title: str, description: str) -> str | None:
    """Create a Linear issue in CTRL via the bash helper. Returns identifier or None."""
    # Write title + description to temp files (avoids all shell escaping).
    with tempfile.NamedTemporaryFile("w", suffix=".title", delete=False, encoding="utf-8") as tf:
        tf.write(title)
        title_path = tf.name
    with tempfile.NamedTemporaryFile("w", suffix=".desc", delete=False, encoding="utf-8") as df:
        df.write(description)
        desc_path = df.name

    try:
        result = subprocess.run(
            ["bash", HELPER, TEAM_ID, STATE_TODO, to_bash_path(title_path), to_bash_path(desc_path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  ERROR (rc={result.returncode}): {result.stderr[:300]}", file=sys.stderr)
            return None
        out = result.stdout.strip()
        if not out:
            print(f"  ERROR: empty response: {result.stderr[:300]}", file=sys.stderr)
            return None
        return out
    finally:
        os.unlink(title_path)
        os.unlink(desc_path)


def main() -> None:
    ctrl = json.load(open("ctrlshft_issues.json"))
    dot = json.load(open("dotfiles_issues.json"))

    issues = []
    for i in ctrl:
        issues.append({
            "title": i["title"],
            "body": i.get("body") or "",
            "source": f"arndvs/ctrlshft#{i['number']}",
            "url": i["html_url"],
        })
    for i in dot:
        issues.append({
            "title": i["title"],
            "body": i.get("body") or "",
            "source": f"arndvs/dotfiles-private#{i['number']}",
            "url": i["html_url"],
        })

    print(f"Creating {len(issues)} Linear issues in CTRL...")
    created = 0
    failed = 0
    for idx, issue in enumerate(issues, 1):
        desc = f"{issue['body']}\n\n---\n**Source:** {issue['source']}\n**GitHub:** {issue['url']}"
        result = create_issue(issue["title"], desc)
        if result:
            print(f"  [{idx}/{len(issues)}] ✓ {issue['source']} -> {result}")
            created += 1
        else:
            print(f"  [{idx}/{len(issues)}] ✗ {issue['source']} FAILED")
            failed += 1

    print(f"\nDone: {created} created, {failed} failed.")


if __name__ == "__main__":
    main()