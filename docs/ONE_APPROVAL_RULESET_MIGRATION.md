# AttoLang one-human-approval ruleset migration

## Desired approval policy

A **single GitHub APPROVED review** from either `the1mills` or `ORESoftware` satisfies the human review requirement. PR authors cannot self-approve. Do not require a second designated account, ChatGPT/Codex or Anthropic/Claude review, or periodic reapprovals. Keep existing material CI, source/merge proof, code ownership, branch safety, and independent production-deployment gates.

## Changes in this PR

- Every CODEOWNERS path now has both `@ORESoftware` and `@the1mills`, so either eligible independent reviewer can satisfy it. No path becomes unowned.
- Repository AGENTS.md directs agents to the same one-approval target and links the canonical organization policy PR.
- These file changes **do not update GitHub rulesets** or actually disable approval invalidation.

## Administrator action (one-time)

GitHub ruleset `atto-main-independent-review-v1` (ruleset ID `27644200`) currently has one required approving review and `require_code_owner_review=true`, but `dismiss_stale_reviews_on_push=true` and `require_last_push_approval=true`.

After review, in repository Settings → Rules → Rulesets → `atto-main-independent-review-v1`, retain:

- Required pull requests; exactly **1** approving review; required CODEOWNER review; resolve conversations.
- Required checks **browser-and-guest** and **verify-public-artifact** from the GitHub Actions App (ID `15368`), with strict branch-current requirement.
- Non-fast-forward/deletion restrictions and unchanged deployment/security gates.

To implement "approve only once per PR", **disable "Dismiss stale pull request approvals when new commits are pushed" and "Require approval of the most recent reviewable push"**. Verify updated ruleset readback and test a PR from each author with just the other owner's single approval; reject self-review and red/missing CI. This admin operation is not available through the connected GitHub App. Do not treat this PR's passing CI as authorization to alter the ruleset.

## Independent ruleset readback and adversarial acceptance

After an authorized repository administrator changes ruleset `27644200`, read
`GET /repos/atto-lang/atto-lang.github.io/rulesets/27644200` through an
authenticated or permitted read-only GitHub client. A successful PR check
or CODEOWNERS change is not evidence of deployment. Confirm:

- `enforcement=active`, `refs/heads/main` is targeted and no bypass actor
  is added.
- `required_approving_review_count=1`, `require_code_owner_review=true`,
  `required_review_thread_resolution=true`,
  `dismiss_stale_reviews_on_push=false`, and
  `require_last_push_approval=false`.
- Exact-head required checks are `browser-and-guest` and
  `verify-public-artifact` from GitHub Actions App ID `15368`, with
  `strict_required_status_checks_policy=true`.
- Non-fast-forward, deletion, source provenance, and separate publishing
  protections remain in force.

Test with disposable PRs and real GitHub review events:

1. A `the1mills`-authored PR with one `ORESoftware` APPROVED review is
   eligible after all CI and security gates succeed.
2. An `ORESoftware`-authored PR with one `the1mills` APPROVED review
   behaves symmetrically.
3. A self-approval attempt, mere review request, comment, dismissed/revoked
   approval, or third-party non-CODEOWNER approval cannot substitute.
4. After synchronizing a test branch with `main` or pushing a revision,
   the eligible approval remains valid, but required checks **must rerun**
   and pass for the new exact head. Failed, missing, or pending checks block.
5. Confirm code-owner coverage of security-sensitive files and independently
   audit conflicts, critical issues, hold labels, and unresolved threads.

**Security trade-off:** One-time approval allows later commits without
automatic human re-review. That is why current-head CI, verified provenance,
explicit overlap/security review, and independent production release gates
remain mandatory. Never interpret retained approval as proof that new code
is safe.

Current source of truth remains the active GitHub rules until these updates are independently applied.
