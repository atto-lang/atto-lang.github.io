# AttoLang GitHub Pages administration bootstrap

Target: **`atto-lang/atto-lang.github.io` only**. This is a narrowly scoped, administrator-operated setup step—not a release or a replacement for independent code review.

## Why this is necessary

The connected GitHub app can read code, create commits and review PRs, but does **not** have the repository Administration/Pages-write capability to modify GitHub Pages Source, create branch rulesets or configure deployment environments. A regular `GITHUB_TOKEN` in a pull request also cannot grant itself those privileges. The legacy branch publisher remains a risk until an administrator changes the setting.

## One audited command path

1. **Review** `admin-bootstrap-pages.mjs` and its tests on the PR. Use your **own local** GitHub CLI login on an administrator-controlled computer. Do **not** paste your token in chat, add it to the repository, or run an admin credential in an untrusted PR workflow. The account must have **Administration: write** and **Pages: write** permissions on this repository. GitHub CLI: `gh auth status`.
2. Fetch/checkout the reviewed PR branch, or put this script and its test file in the same directory. Run `node --test admin-bootstrap-pages.test.mjs`.
3. Apply to the explicitly named public repo:

   ```sh
   node admin-bootstrap-pages.mjs --apply --confirm atto-lang/atto-lang.github.io
   ```

   The script uses the existing `gh` login (not a pasted token) and attempts only: (a) Pages `build_type=workflow` + HTTPS enforcement, (b) one active `main` ruleset with required independent review, code-owner and strict app-pinned `verify-public-artifact` CI, (c) protected-branch-only `github-pages` environment with both named reviewers, `prevent_self_review=true`, and `can_admins_bypass=false`. **It never merges, approves a compiler, dispatches a workflow or deploys Pages.**

4. Independently reread the effective settings:

   ```sh
   node admin-bootstrap-pages.mjs --verify
   ```

   Accept **only** `ADMIN_POLICY_VERIFIED` with the exact `main_head`. If any API call is unavailable or an update is ignored, the program fails closed. It does **not** infer success from a successful mutation response.

5. In GitHub UI, confirm the environment's **Disable administrator bypass** checkbox. The REST API documents required reviewers and branch restrictions; the `can_admins_bypass` update flag is not formally described in the current environment write endpoint documentation, so the script's GET readback is intentionally decisive. Also check the ruleset UI for any bypass actors and that `main` is genuinely protected.

6. Have **someone other than the PR author** provide valid GitHub review approval on PR #10, then on the latest heads of #13 and #14 after stack reconciliation. Only then merge sequentially, approve the exact compiler digest by independent process, manually dispatch the protected release, and require the real HTTPS audit to pass.

## Safe reruns and incident behavior

- The script is **idempotent**: it will not create another ruleset if its named ruleset already exists and matches the expected policy. An unexpected conflicting managed ruleset halts execution without replacing it.
- It changes legacy Pages Source **first**, so if subsequent administrative steps fail, unsafe automatic branch publishing has already been disabled. This can leave the public site without a new deployment until the approval path is completed; do not revert to legacy publishing to restore service.
- On failure, the script deliberately does not echo CLI output that might include sensitive repository information. Diagnose permission/API failures with your own authenticated terminal.
- If a protected setting remains missing, the release is **NOT_CERTIFIED**. No token is embedded in this script or its output.

Sources: [GitHub Pages REST API](https://docs.github.com/en/rest/pages/pages), [Repository rulesets REST API](https://docs.github.com/en/rest/repos/rules), and [Deployment environment REST API](https://docs.github.com/en/rest/deployments/environments).