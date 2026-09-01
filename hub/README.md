# Hub Release & Tooling

This directory holds the hub's release and operational tooling.

## Releasing

The hub is the single source of truth for the Sandcastle engine. Consumers
reference it remotely via `uses: arndvs/ctrlshft-hub/...@<ref>`. A release
tags a stable version so consumers can pin to it.

```bash
# From the hub repo root:
hub/release.sh            # bump patch (v1.2.3 -> v1.2.4)
hub/release.sh minor      # bump minor
hub/release.sh major      # bump major
hub/release.sh 1.4.0      # explicit version
hub/release.sh --dry-run  # preview without tagging
```

`release.sh`:
1. Reads the latest `vX.Y.Z` tag (or starts at `v0.1.0`).
2. Computes the next version.
3. Tags + pushes the release.
4. Prints the SHA + tag for consumers to pin.

### Consumer pinning

After a release, a consumer can pin its `.sandcastle/hub-version.json`:

```json
{
  "ref": "v1.2.4",
  "lastPinnedSha": "abc1234",
  "reviewedAt": "2026-08-18"
}
```

Or update workflow stubs to reference the tag:

```yaml
uses: arndvs/ctrlshft-hub/actions/agent-run@v1.2.4
uses: arndvs/ctrlshft-hub/.github/workflows/reusable-keep-tests-tight.yml@v1.2.4
```

## Linear provisioning

`provision-linear.py` + `linear-create.sh` bulk-create Linear issues from
GitHub PRDs into the CTRL team (the cross-repo work home). See the script
headers for usage.

## Replacing `update-sandcastle.sh`

The old `update-sandcastle.sh` vendored engine files into every consumer.
That flow is retired: consumers no longer vendor; they reference the hub.
`release.sh` is the replacement — it tags versions instead of copying files.
