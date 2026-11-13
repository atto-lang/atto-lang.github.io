# atto-lang.github.io

Official AttoLang documentation, language reference, tutorials, and ecosystem website.

## Project scope

Language documentation, learning material, and public ecosystem navigation.

## Technical papers

The [AttoLang Technical Papers](https://atto-lang.github.io/whitepapers/) provide versioned technical explanations of language design, compiler architecture, memory ownership, actor concurrency, and portable AOT. Each paper separates documented implementation evidence from design goals and planned capabilities.

## Development and validation

Use checked-in site build and publishing workflows for validation. Keep language claims tied to the canonical specification and tested backend support.

## Status

This is a statement of intended scope, not a claim of completed implementation or production readiness. Source, CI, and checked-in examples are authoritative for actual supported features and commands.

## Ecosystem

- [AttoLang organization](https://github.com/atto-lang)
- [Language specification](https://github.com/atto-lang/atto-spec)
- [Platform conformance](https://github.com/atto-lang/atto-platform-conformance)

## Interactive browser playground

The static route /play/ is implemented on the main branch and is published at [AttoLang Playground](https://atto-lang.github.io/play/). It ships a real browser-hosted Wasm compiler and a separate compiled guest Wasm module. It compiles a documented AttoLang subset; do not advertise full compiler parity. The public route includes Node WebAssembly guest tests and real Chromium browser tests.

The [playground compiler contract](play/docs/COMPILER_CONTRACT.md) describes the supported subset, compiler and guest ABIs, actor worker behavior, and security constraints.

## User-created programs and editor highlighting

The /play/ editor has a **Custom +** selector for saving up to 30 named programs in this browser's same-origin localStorage (64 KiB per program), with explicit Save/overwrite and Delete controls. Saved programs are not submitted to a server or synced between browser profiles/domains. The native textarea retains keyboard and assistive access while a noninteractive text-only overlay colorizes code tokens; this is not a full semantic formatter or substitute for the compiler.

## Canonical Rust Wasm formatter

The /play/ route offers **Format** and **Check format** actions powered by the Rust formatter built as a separate, import-free Wasm binary. See play/public/oreslang_format.receipt.json for the source and SHA-256. Formatting is local, uses a disposable worker, and only applies source edits on success. Check format never changes code. The formatter is not a compiler or type checker.

## Marketing homepage release candidate

The repository root now has a static AttoLang marketing landing page with a local
`./play/` link, and the guarded artifact builder explicitly publishes only the
rendered homepage, allowlisted CSS, playground assets, and reviewed whitepapers.
This change alone is **not** a production deployment. Before publication, the
administrators must resolve [Pages source bypass P0 #5](https://github.com/atto-lang/atto-lang.github.io/issues/5),
protect the deployment environment and `main`, obtain independent approval, and
dispatch the reviewed compiler-digest release. Do not bypass that path by pushing
to an unprotected, branch-published site.


## GitHub Pages secure-publishing cutover (administrator action)

Site source and binary publication are governed by [Pages security issue #5](https://github.com/atto-lang/atto-lang.github.io/issues/5).
**The default branch publisher is NOT an acceptable secure release path.**
The manual reviewed publication must only proceed after a GitHub administrator
switches Settings → Pages to **GitHub Actions**, protects `main` with one
independent CODEOWNERS approval plus exact GitHub Actions checks, and sets
`github-pages` to require an independent trusted reviewer, disallow self-review
and administrator bypass, and restrict deployment to protected branches.

A read-only inspection and an explicit opt-in administrator CLI are supplied,
but they **never run mutation under CI**. From an authorized workstation with
`gh auth` as a GitHub repository administrator, first inspect with
`node .github/scripts/admin-secure-pages.mjs --check-site`. Only after
reviewing changes, apply using
`ATTO_ADMIN_APPLY=YES node .github/scripts/admin-secure-pages.mjs --apply-site`;
then rerun `--check-site`. The private compiler repository has separate
GitHub-plan restrictions and is deliberately excluded by `--apply-site`.
These source changes do not themselves modify the GitHub Pages settings,
review other authors' PRs, approve binary disclosure, or deploy.

## Pages publishing mode is a separate release gate

A manual release job calls read-only GitHub API endpoints for the public site's Pages configuration **and** its `main` branch, then fails closed unless `build_type=workflow`, HTTPS is enforced, `main.protected === true`, the branch's current commit matches the exact `GITHUB_SHA` being released, **and the active branch rules require independent code-owner PR review, current approvals, an app-pinned and strictly up-to-date `verify-public-artifact` CI check, and denial of force-push and deletion**. An unprotected or advanced main branch, missing rights, API errors, redirects and malformed replies all block publication. This protects the *manual* publishing path only and cannot disable independent legacy Pages auto-deployment. This preflight cannot disable an independently configured legacy branch-source Pages deployment. An administrator **must** change Settings → Pages → Source to GitHub Actions, protect the `github-pages` deployment environment, and verify no automatic Pages deploy after an ordinary main push; see [P0 issue #5](https://github.com/atto-lang/atto-lang.github.io/issues/5). Public compiler Wasm already exists in this public repository and must be treated as disclosed.


## Legacy Pages branch-source containment (interim)

A root `_config.yml` explicitly excludes `play/tests/`, `play/package.json`, backup/build scripts, and other non-release files from *Jekyll-based legacy branch builds*. This is a mitigation only; it neither creates the approved `release-manifest.json` nor makes an unreviewed Pages build trustworthy. **P0 #5 remains blocking until an administrator changes Pages Source to GitHub Actions, protects the deployment environment, and the live HTTPS audit passes.** These paths remain accessible through the public Git repository.


## Administrator-only security requirements

The `.github/CODEOWNERS` file declares `@ORESoftware` for the public compiler binary, worker/runtime assets, Pages workflows, source-check scripts and default files. **CODEOWNERS is not enforced without a protected main-branch rule requiring code-owner approval** (and authors cannot approve their own PRs). Configure and verify all of the following before dispatching a public compiler release:

1. GitHub **Settings → Pages → Build and deployment → Source: GitHub Actions**. Verify that a normal main push does not launch a legacy `pages build and deployment` workflow.
2. Protect `main` using an **active branch ruleset** with at least one independent approval, required code-owner review, stale-approval dismissal, latest-push approval, review-thread resolution, no force-push/deletion, and a strict `verify-public-artifact` status check pinned to its GitHub Actions app integration ID. The preflight fetches `GET /rules/branches/main?per_page=100` and fails if it cannot verify these effective rules. Classic branch protection alone does not satisfy this stricter gate.
3. Protect the `github-pages` environment: allow **protected branches only**, configure at least one authorized reviewer (`ORESoftware`), **prevent self-review**, and **disable administrator bypass**. The manual workflow now queries `GET /repos/atto-lang/atto-lang.github.io/environments/github-pages` and fails closed unless those settings are returned exactly; it checks them both before the compiler disclosure gate and again after environment admission, immediately before deployment. Any missing API field or denied `actions: read` access blocks publication. Ensure only reviewed release workflows have both `pages: write` and `id-token: write`.
4. Require a separately reviewed and administrator-controlled `ATTO_PUBLIC_COMPILER_SHA256` value, explicit manual dispatch, matching commit/tree, and a verified public release manifest.
5. Perform a live HTTPS audit of the deployed compiler Wasm digest, MIME, CSP, source-only browser operation and forbidden build/test assets. Failed or unavailable live audits are **NOT_CERTIFIED**.

The preflight proves neither review-rule configuration nor deployed artifact safety. Its protected-branch check is a necessary defense in depth, not proof of independent approval. The public compiler binary remains disclosed through public repository history; policy improvements do not reverse that.

### Active-rule preflight limits

GitHub's effective-rules endpoint reports **active** branch rules and excludes disabled/evaluate-only rules. The manual workflow inspects that endpoint and repeats the complete read-only release preflight inside the deployment job after environment approval, immediately before `deploy-pages`. It fails closed on missing rules, unpinned required status checks, denied API access, unexpected redirects, pagination indicating an incomplete snapshot, malformed responses, an unprotected or changed `main`, or wrong Pages publishing mode.

The effective-rules endpoint **does not prove that bypass actors are absent**. The administrator must inspect the full rulesets (including bypass permissions), verify branch owners and `github-pages` environment reviewers, and test both denied and permitted deployment paths. Even the second preflight cannot make the GitHub Pages deployment and a mutable `main` ref atomic; the artifact is pinned to the workflow SHA and a live postflight still gates any release-certification claim.

### Synchronous release postflight (fail closed)

The authorized GitHub Pages deployment job now invokes the exact-commit, administrator-approved live HTTPS auditor **after** `actions/deploy-pages` completes. It allows up to eight read-only checks with 15-second intervals to accommodate edge propagation; any persistent missing manifest, stale digest, mismatched HTML/JS/Wasm asset, incorrect browser MIME/CSP, or HTTP exposure of a non-release test/build path makes the **release workflow fail** rather than reporting success. The forbidden probes include previously verified legacy disclosures: `play/tests/browser-e2e.mjs`, `play/tests/compiler.test.mjs`, `play/tests/ui.test.mjs`, and `play/package.json`.

A failed post-deployment audit **does not roll back already published files**. Treat the affected public release as **NOT_CERTIFIED**, investigate immediately and recover through an independently approved corrected deployment; this is not a substitute for changing Pages source to GitHub Actions or protecting `main` and the deployment environment. The separate read-only live detector in PR #14 remains important for continuous exposure monitoring between deployments.
