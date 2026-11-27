# AttoLang governance observation pilot

This proposal adds a **read-only observation** workflow to the AttoLang website repository. It is not the actual governance gate. Require independent approval under the existing independent-review rules and the current single trusted-owner policy.

## Verified baseline at proposal time (November 26, 2026)

The public repository has an active main-branch ruleset **atto-main-independent-review-v1** (ID 27644200) with no bypass actors, one required approving review, no stale approval dismissal, no last-push approval requirement, no required CODEOWNER or resolved-thread gate, and strict issuer-bound required checks **browser-and-guest** and **verify-public-artifact** (GitHub Actions App ID 15368). The workflow checks at least one required approval, review-setting visibility, strict issuer-bound checks, and rejects visible bypass actors. Independent trusted-owner identity and overlap review remain mandatory outside this observation.

No `atto-governance/draft-hold` or `atto-governance/reviews-verified` requirement is asserted or installed by this PR. Those require reviewed trusted controllers and provider-specific AI issuer bindings from the upstream policy stack `atto-lang/.github` PRs #49, #50 and #51.

## API visibility limitation found in executable pilot

The repository-scoped GitHub Actions token returns `null` for the ruleset's `bypass_actors` field, while an administrative GitHub API read reports `[]` on this same ruleset. The pilot **does not infer absence of bypass from the redacted field**. It emits `BYPASS_UNVERIFIED` and a warning, still fails if a nonempty bypass list is actually visible, and still verifies all visible review and CI settings. This means a successful observation job is never proof that no bypass exists; administrator confirmation remains an explicit deployment prerequisite.

## Safety

- `pull_request` or opt-in manual dispatch only, with *read-only* repository-scoped token. No `pull_request_target`, deployment secrets, PR-head code checkout, GitHub App installation or write permissions. To satisfy the site's existing SHA-pinned action audit, the workflow checks out only the immutable protected-base commit using the already approved `actions/checkout` SHA, verifies that commit, and does not execute its source.
- Reads the current PR via authenticated `gh api`, validating repository, number, SHA, labels and Draft state. Prints a warning if `keep-as-draft`, `not-ready`, or legacy `keep-draft` is present but the PR is Ready.
- No PR source is checked out or executed. No external unreviewed policy source is fetched. No branch rulesets, statuses, labels or Ready/Draft state are mutated.
- This **does not** block merges and must **not** be added to the required governance status check list. The observation job's success is not approval.
- Triggers on its own workflow and documentation changes (and manual dispatch after merge); it is **not** a continuous event reconciler for all PRs.

## Path to real enforcement

Any future enforcement must implement the current single trusted-owner policy, hold labels, and exact-head CI without requiring AI-family approvals. Review any controller independently before deployment. No protection changes are authorized by this pilot.

If Actions budget is exhausted, use only an explicitly authorized **private** test carrier with token-free Git tree transfer and independently verified per-blob plus full-root-tree SHAs; do not copy private source to public test repositories or substitute queued/zero-step workflows for proof.
