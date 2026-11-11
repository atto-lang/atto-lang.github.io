# AttoLang v2 playground — protected release checklist

## Source and compiler evidence

- Mainline canonical compiler uses atto.browser.guest.v2. The pinned public compiler receipt must match its binary SHA-256, byte length, compiler_abi=2, guest_abi=atto.browser.guest.v2, and a 40-hex source head/tree.
- Never publish new private compiler bytes, or re-label a v1 binary as v2, without independent authorization of its exact source, tree, digest and disclosure.
- PR #36 retains actor_init/actor_receive and per-actor instances while transferring ownership of child Web Workers to the page. A green source-free canary is not compiler-backed guest evidence.

## Configure both repositories' main branches

- Require pull requests, at least one independent approval, CODEOWNERS, stale-review dismissal and last-push approval.
- Require executed exact-head checks; public checks browser-and-guest and verify-public-artifact, compiler check real-compiler.
- Forbid force-pushes, deletion and unauthorized bypass. Admins must inspect protection settings directly.

## Configure GitHub Pages publication

- Use GitHub Actions for Pages, HTTPS required; protect github-pages environment with protected branches only.
- Require independent ORESoftware environment approval and prevent self-review.
- Manual publish must run on protected main and include confirm_public_disclosure=yes and the independently approved ATTO_PUBLIC_COMPILER_SHA256 repository variable.
- The dispatch preflight must successfully read branch rules, Pages and environment settings and fail closed when API permissions or any protection are missing.

## Acceptance

- Approve the current PR exact head, run tests with nonzero execution, merge only after review and protection.
- Verify merged-tree CI, authorize the compiler digest separately, then run protected workflow_dispatch.
- Inspect the real HTTPS origin, release-manifest.json, current source commit and compiler digest; run live class, enum and stateful multi-actor tests.
- Do not interpret upload-pages-artifact or a skipped deploy job as evidence of a public deployment.
- Worker termination accounting is JavaScript-handle evidence, not proof of OS worker exit or CPU/RSS reclamation.

## Administrator CLI handoff (not executed by ChatGPT)

The GitHub connection used for repository changes **cannot** change GitHub Pages,
branch rulesets, or environment reviewers. An authenticated GitHub administrator
can run the checked-in script locally (Node 22 and GitHub CLI required):

```bash
gh auth status
gh repo clone atto-lang/atto-lang.github.io
cd atto-lang.github.io
gh pr checkout 36
node .github/scripts/admin-secure-pages.mjs --check
ATTO_ADMIN_APPLY=YES node .github/scripts/admin-secure-pages.mjs --apply
node .github/scripts/admin-secure-pages.mjs --check
```

The script is read-only unless **both** `--apply` and
`ATTO_ADMIN_APPLY=YES` are present. It creates no-bypass, active main
rulesets in the public playground and private Rust compiler repos; requires
one independent code-owner/last-push approval and strict named CI checks;
restricts the public `github-pages` environment to protected branches
with `ORESoftware` approval (self-review disabled); and only **last**
switches Pages from its legacy branch-source auto-publisher to Actions-only
HTTPS publication. It refuses existing conflicting named rulesets and
unexpected deployment reviewers rather than overwriting them.

**Preconditions:** the authenticated CLI account must have GitHub repository
Administration and Pages write permissions on the relevant repositories.
The browser/private repo's `CODEOWNERS` file must be in the base branch for
code-owner review enforcement to apply, so ensure the companion CODEOWNERS
PR is reviewed and merged through independently reviewed governance.

A successful script run is **not** release authorization. Obtain
`ORESoftware`'s GitHub `APPROVED` review of the exact final PR head.
After the protected merge and merged-head CI, independently approve the
canonical compiler source/tree and released SHA-256 before changing
`ATTO_PUBLIC_COMPILER_SHA256` (using `gh variable set -R`).
Manually dispatch the guarded release workflow on `main` and verify the
executed deploy job and live origin. Do not set compiler digest, merge,
or dispatch from the administrator setup script.
