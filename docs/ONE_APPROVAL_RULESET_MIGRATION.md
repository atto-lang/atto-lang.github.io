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

Current source of truth remains the active GitHub rules until these updates are independently applied.
