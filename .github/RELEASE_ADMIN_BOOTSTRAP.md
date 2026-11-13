# Secure public GitHub Pages bootstrap (administrator procedure)

> This is a human-administered, security-sensitive cutover. **No branch merge or workflow result substitutes for an independent reviewer or production authorization.** This document and the CLI do not modify settings unless an authorized administrator explicitly executes the apply command.

## Observed incident

As of `2026-11-13`, `atto-lang/atto-lang.github.io` has an unprotected `main`, zero rulesets, and a legacy GitHub-managed `pages build and deployment` job that automatically published merges #45 and #47. Protected manual release jobs have skipped deploy. The public origin has previously served unallowlisted files and lacked `/release-manifest.json`. Track incident and evidence in issue #5.

## Sequence

1. Independently review this narrow admin-script PR and the scoped required-check fix in PR #46. Have `ORESoftware` approve the exact security heads; do not approve your own commits.
2. An authorized site administrator should switch **Settings → Pages → Build and deployment → Source = GitHub Actions** immediately (or temporarily disable Pages) to stop legacy branch-root publishing before the next merge. Verify **Pages `build_type=workflow`** via an authenticated API read.
3. In an authenticated terminal with `gh auth status` showing an account with administration privileges for the **public site** (not a CI `GITHUB_TOKEN`), check the reviewed CLI with:

   ```bash
   node .github/scripts/admin-secure-pages.mjs --check-site
   ```

   An exit code of 2 means the controls are not yet installed. Unexpected API response or mismatched named rulesets must fail closed; investigate rather than force.
4. With explicit authorization, apply only public site protection; no private compiler source disclosure or private-plan change:

   ```bash
   ATTO_ADMIN_APPLY=YES node .github/scripts/admin-secure-pages.mjs --apply-site
   node .github/scripts/admin-secure-pages.mjs --check-site
   ```

5. Inspect the resulting public `main` ruleset: active, no bypass, no force/deletion, at least one independent review, stale-review dismissal, last-push and code-owner approval, resolved discussions, strict Actions-app checks `verify-public-artifact` and `browser-and-guest`. Ensure these are triggered on **all PRs** (PR #46). Review environment `github-pages`: protected branches, **`ORESoftware`**, prevent self-review, **no admin bypass**.
6. After the authenticated cutover is verified, merge PR #46 **only with independent exact-head review** and green checks, not via legacy publishing. Re-run merged-main checks and the negative release test: an ordinary push must not create a dynamic `pages build and deployment`; unapproved manual dispatch must not deploy.
7. Independently approve public compiler provenance and `ATTO_PUBLIC_COMPILER_SHA256`, then dispatch the existing release workflow on protected main. Verify actual origin: `/release-manifest.json` 200, exact compiler SHA, `application/wasm`, and all forbidden tests/source/package paths 404 or 410. Keep issue #5 open until independent live proof succeeds.

**Scope:** the script does not approve PRs, change a compiler SHA variable, merge, dispatch releases, or deploy. `--check` / `--apply` are intentionally stricter all-repository modes and may be blocked by private compiler ruleset entitlement; use `--check-site` and `--apply-site` for public site cutover. Never make the private compiler public as a workaround.

**Tool limitation:** ChatGPT's GitHub connector cannot write Pages-source, environment or ruleset admin endpoints. The connected Make GitHub REST shell also cannot be activated while Make's active-scenario limit is reached; do not disable unrelated scenarios to bypass this.
