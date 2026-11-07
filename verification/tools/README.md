# Read-only GitHub metadata collector

This tool is strictly **source-free** and **GET-only**. It reads PR/commit-tree metadata, workflow and job IDs, independent-review metadata, and artifact SHA-256/expiration metadata. It does **not** fetch compiler source, run logs, artifacts, or any guest outputs, and it never triggers CI or writes GitHub data.

**Source restrictions:** private repository identifiers and metadata must remain private. Do not commit generated JSON into this public site repository, open public issues containing collected private identifiers, or publish snapshots to GitHub Pages. Only run it from an explicitly approved environment. The GitHub access token, if needed, comes from the operator's environment; grant read-only permissions on the exact authorized repositories. Do not supply the token to the browser.

Example with synthetic placeholder values:

```sh
GITHUB_TOKEN="$READ_ONLY_TOKEN" node verification/tools/collect-readonly.mjs \
  --repo example-org/compiler --pr 42 --backend LLVM --feature "Checked arithmetic" \
  --workflow 11 --run 22 --job 33 --artifact guest-receipt \
  --contract checked-i64 --version v1 --out ./local-untrusted-evidence.json
```

For authorized exact-tree mirror CI, also supply `--ci-repo approved-org/mirror --mirror-repo approved-org/mirror --mirror-commit <40-hex-commit>`. Only source and mirror **Git tree SHAs** are compared; executing a mirrored tree still requires independently authorized transfer/provenance. Never use this command as permission to mirror source.

The output follows `../schemas/metadata-snapshot.v1.schema.json`; `node --test verification/tests/*.test.mjs` tests the schema and collector. The output is created locally (exclusive creation, permission 0600) and is always **NOT_EXECUTED / NOT_CERTIFIED**. It does not turn green CI into guest-executed evidence and is not a release attestation. It must pass a separate authorized artifact/guest receipt verifier and external trust-root signature verifier before any future qualification.

The collector rejects stale runs (>72 hours), PR-head drift during collection, reruns, mismatched workflow IDs/job attempts, missing runner provenance, source/mirror tree inequality, missing/expired/misbound artifact digests, malformed/replayed metadata, and incomplete pagination. The latest independent review is advisory, not proof of protected branch compliance; the PR author cannot self-approve.

**Publishing:** the site PR remains blocked by [Pages issue #5](https://github.com/atto-lang/atto-lang.github.io/issues/5). No merge/deploy authorization is implied by this tool or its passing tests.
