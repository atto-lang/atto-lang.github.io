# AttoLang Evidence Control — staged public UI

This directory contains a **source-free, read-only, local-first** browser dashboard for tracking exact-head evidence, five-backend conformance, host/parser vs guest execution, independently reviewed PRs, mirror tree identities, and fail-closed merge/release status.

Open `verification/index.html` locally. It is a self-contained static HTML page with no third-party scripts, accounts, tokens, telemetry, uploaded source, or external data. Synthetic demo data is visibly labeled and **cannot certify**. Evidence is stored only in the local browser and may be exported/imported as untrusted JSON. The only optional network traffic is unauthenticated **GET** requests to public GitHub metadata. Private repository data must not be added to this public repository, PR, logs, or Pages.

## Publication/security gate — BLOCKED

**Do not merge or deploy this PR while [atto-lang.github.io#5](https://github.com/atto-lang/atto-lang.github.io/issues/5) is unresolved.** Pages currently supports a branch-source publication path that may bypass manual release review. An independently authorized site administrator must first:

1. Disable branch-based automatic publication or explicitly switch Pages to **GitHub Actions**.
2. Require independent reviewers, CI and an enforced `github-pages` environment approval for all publishing paths.
3. Validate that only an approved manual release workflow holds `pages: write` and `id-token: write`; preserve existing playground/compiler release authorization.
4. Demonstrate that a push to `main` does **not** deploy, an unauthorized dispatch fails, and an authorized exact-artifact dispatch succeeds.
5. Independently review and approve this site (synthetic data and no sensitive identifiers); inspect deployed bytes and CSP.

The PR workflow is **tests only**. It has `contents: read`; it never runs `deploy-pages`, uploads evidence, checks out compiler source, starts source CI, signs certificates, or exports source files.

## Scope and trust model

- Five backends: Java/GraalVM, LLVM, Wasm, Forge/Cranelift, .NET.
- Receipt identity: exact PR head SHA, tree SHA, mirror commit/tree, workflow/run/job IDs, run attempt, runner, artifact SHA-256, contract ID/version and independent approval.
- Host-only, parser-only, failed, stale, missing and `NOT_EXECUTED` are **not** guest-executed parity.
- This local browser cannot authenticate import provenance or issue release certificates. **Release is always `NOT_CERTIFIED`** until an external, trusted signing authority checks protected-branch review, immutable provenance, and execution evidence.
- All real source repositories in `atto-lang/atto-source.*` currently require private access. Keep those proofs in an approved private evidence path. Do not expose them in static Pages.

## Offline verification

```sh
node --test verification/tests/*.test.mjs
```

The tests are dependency-free, verify CSP script hashes, reject network writes, guard sample data, stale exact-head evidence, fake guest claims, and forged approvals. They do not certify a deployed Pages site or private CI runners.
