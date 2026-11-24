# Private CI external trust anchor

This public repository stores **authorization metadata only**. It must never
contain Oreslang private source, generated source archives, Git bundles,
source-bearing Actions artifacts, caches, or logs.

An authorization is valid only when it is present on this repository's
protected `main` branch after an independent pull-request review. The live
branch must require pull requests, at least one approving review, stale-review
dismissal, administrator enforcement, no review bypass actors, and disabled
force-push/deletion.

Each manifest binds one exact private source PR head and root Git tree to one
exact private carrier repository/base/workflow/test-plan. A source PR advance,
carrier `main` advance, repository delete/recreate, workflow or plan change,
expiry, visibility change, or manifest change invalidates the authorization.

The connector-mediated publisher must verify the protected anchor and all live
identities before reading or writing private source bytes; then it may create
only a fresh `ci/oreslang-<source-tree-sha>` source-bearing branch and the
matching `ci/authorized-<carrier-commit-sha>` authorization ref in the pinned
private carrier. It must verify the uploaded isolated subtree has the exact
authorized source root-tree SHA before attaching either ref.

This trust anchor is source-free by construction.


## V4 carrier verification

The carrier does not trust its own unprotected default branch as an authorization
root. The protected public anchor is the authority.

Before executing mirrored source, the carrier verifies all of the following and
repeats the complete check immediately before source execution:

1. The live anchor repository has numeric ID `1409246164`, remains public, and
   its default branch is `main`.
2. Anchor `main` reports `protected=true`.
3. The current `main` tip is the actual merge commit of authorization PR #52.
4. PR #52 has an effective independent `APPROVED` review whose `commit_id`
   equals the exact PR head. The PR author cannot satisfy this requirement.
5. The authorization manifest is fetched by that immutable merge SHA, not by a
   moving branch name.
6. The carrier source-bearing commit has exactly one parent and that parent is
   the manifest's exact `destination.base_sha`.
7. The inherited carrier workflow blob and PR1668 test-plan blob match the
   manifest exactly.
8. The source-bearing branch name is exactly
   `ci/oreslang-<authorized-source-root-tree-sha>`.
9. The exact `ci/authorized-<carrier-commit-sha>` ref exists and points to the
   event commit.
10. The anchor `main` ref is re-read after all dependent metadata reads and
    must still point to the same protected merge commit.

This makes a later direct push, force-push, carrier-main advance, workflow
change, plan change, stale review, or authorization replacement fail closed.
The private carrier's live `main` branch is not itself an authority.

## V4 receipt

A source-bearing carrier commit uses schema `ores-private-ci-receipt-v4`. It
retains the V3 source, destination, carrier, mirror and test-plan bindings and
adds this exact authorization object:

```json
{
  "authorization": {
    "repository": "ores-truffle-oreslang/ores-truffle-oreslang.github.io",
    "repository_id": 1409246164,
    "branch": "main",
    "pr": 52,
    "merge_sha": "<protected anchor main merge SHA>",
    "manifest_path": "ci/private-ci/authorizations/java-pr1668.json",
    "manifest_blob_sha": "<Git blob SHA of the merged manifest>",
    "manifest_sha256": "<SHA-256 of the exact merged manifest bytes>"
  }
}
```

The receipt's source repository ID, PR number, head SHA and root-tree SHA must
match the merged manifest. Its destination repository ID/base SHA, carrier
workflow blob, mirrored root tree, and test-plan path/SHA-256 must also match.
The carrier verifies these bindings before any Oreslang build command runs.

The connector-mediated publisher must verify the source repository is still
private and that the named PR's exact head and root tree still match the merged
authorization before creating any private Git blob in the carrier.
