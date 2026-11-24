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
private carrier. The source-bearing ref itself must not trigger Actions. After
the exact source-bearing commit is verified, the publisher creates a separate
source-free `ci/oreslang-control-<carrier-commit-sha>` commit, based on the authorized
carrier base, containing only dispatch metadata. That control ref runs the
trusted workflow inherited from the authorized source-free base. It must verify
the uploaded isolated subtree has the exact authorized source root-tree SHA
before attaching any execution ref.

This trust anchor is source-free by construction.


## V4 carrier verification

The carrier does not trust its own default branch as an authorization root.
The protected public anchor is the authority.

Each V4 receipt names one source PR and one authorization PR. Before executing
mirrored source, the carrier verifies all of the following and repeats the
complete check immediately before source execution:

1. The live anchor repository has numeric ID `1409246164`, remains public,
   and its default branch is `main`.
2. Anchor `main` reports `protected=true`, and the effective branch-rules
   API for `main` must show a pull-request rule with at least one approval,
   stale-review dismissal, CODEOWNER review, last-push approval, and required
   review-thread resolution, plus deletion protection and non-fast-forward
   protection. The carrier checks these effective rules both before dependent
   reads and again before execution.
3. The receipt-named authorization PR is closed, non-draft, actually merged,
   and its merge commit is the current protected `main` tip.
4. That authorization PR has an effective `APPROVED` review from the
   designated security reviewer `@ORESoftware` (GitHub user ID `11139560`)
   whose `commit_id` equals the exact PR head. The PR author cannot satisfy
   this requirement, and an arbitrary independent reviewer is insufficient.
5. The authorization PR's changed-file set contains the exact
   `ci/private-ci/authorizations/java-pr<source-pr>.json` manifest blob.
   An unrelated reviewed PR that merely inherits an older manifest cannot
   authorize source execution.
6. The authorization manifest is fetched by the immutable merge SHA, not by a
   moving branch name, and its source PR must equal the receipt source PR.
7. The carrier source-bearing commit has exactly one parent and that parent is
   the manifest's exact `destination.base_sha`.
8. The inherited carrier workflow blob and
   `ci/test-plans/java-pr<source-pr>.json` blob match the manifest exactly.
9. The source-bearing branch name is exactly
   `ci/oreslang-<authorized-source-root-tree-sha>`, and that ref is not an
   Actions trigger.
10. The exact `ci/authorized-<carrier-commit-sha>` ref exists and points to
    the source-bearing commit.
11. Execution is dispatched only by a source-free
    `ci/oreslang-control-<carrier-commit-sha>` commit whose sole parent is the
    authorized carrier base and whose only change is strict dispatch metadata.
    The trusted workflow validates the protected authorization before checking
    out the private source-bearing commit.
12. Anchor `main` is re-read after all dependent metadata reads and must still
    point to the same protected authorization merge commit.

This makes a later direct push, force-push, carrier-base advance, workflow
change, plan change, stale review, unrelated reviewed PR, authorization
replacement, or anchor movement fail closed. The private carrier's live
`main` branch is not itself an authority.

## V4 receipt

A source-bearing carrier commit uses schema `ores-private-ci-receipt-v4`.
It retains the V3 source, destination, carrier, mirror and test-plan bindings
and adds an authorization object of this form:

```json
{
  "authorization": {
    "repository": "ores-truffle-oreslang/ores-truffle-oreslang.github.io",
    "repository_id": 1409246164,
    "branch": "main",
    "pr": "<authorization-pr>",
    "merge_sha": "<protected anchor main merge SHA>",
    "manifest_path": "ci/private-ci/authorizations/java-pr<source-pr>.json",
    "manifest_blob_sha": "<Git blob SHA of the exact reviewed manifest>",
    "manifest_sha256": "<SHA-256 of the exact reviewed manifest bytes>"
  }
}
```

The receipt's source repository ID, PR number, head SHA and root-tree SHA must
match the reviewed manifest. Its destination repository ID/base SHA, carrier
workflow blob, mirrored root tree, and exact per-source-PR test-plan
path/SHA-256 must also match.

The connector-mediated publisher must verify that the source repository is
still private and that the named source PR's exact head and root tree still
match the merged authorization before creating any private Git blob in the
carrier.

