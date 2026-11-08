# AttoLang playground release — administrator checklist

This is a **release hold**, not a declaration that a deployment is approved.
Source PR #21 and private compiler PR #28 are separate reviews. The private
compiler build must never be copied into the public site based solely on a
passing test or an approval of a different commit.

## Set on BOTH \`atto-lang/atto-lang.github.io\` and \`atto-lang/atto-source.rs\`

- Create an **active ruleset** on \`main\` requiring PRs, >=1 actual independent approval,
  **CODEOWNERS**, **dismiss stale reviews**, and **approval of the last push**
  by someone other than the last pusher.
- Require executed exact-head GitHub Actions checks. For the public repo:
  \`browser-and-guest\` and \`verify-public-artifact\`; for compiler:
  \`real-compiler\`. Check actual UI job names before making them required.
- Disallow force push, deletion, and unauthorized bypass; enable protections
  for administrators. Inspect bypass actors in repository admin settings; a
  read-only status API cannot prove every administrator bypass is absent.
- Do not enable auto-merge until all independent approvals and checks count.

## Set on public Pages repository

- Configure **Settings → Pages → Build and deployment → GitHub Actions**,
  not a direct branch-source path; require HTTPS.
- Protect the \`github-pages\` environment: deployments from **protected
  branches only**, require an ORESoftware independent reviewer and prevent
  self-review. Prohibit admin bypass where supported.
- The \`workflow_dispatch\` publish action must originate from protected
  \`main\` and have \`confirm_public_disclosure=yes\`; set repository variable
  \`ATTO_PUBLIC_COMPILER_SHA256\` only **after independent approval of the exact
  private artifact's source head, tree, provenance and digest**.
- Keep the binary in private artifacts until disclosure is explicitly
  approved; no cross-repo publication by PR CI.

The dispatch release workflow now invokes
\`.github/scripts/verify-release-governance.mjs\`, which **fails closed**
on inaccessible/missing or incomplete live GitHub branch-rule, Pages,
and environment responses. It is intentionally not run on PR smoke checks
because repository settings are an administrator responsibility, and it does
not substitute for human security review or bypass inspection.

## Post-deploy verification

Verify **both** approved HTTPS origins (GitHub Pages and configured custom
domain if present), inspect \`/release-manifest.json\`, validate source commit,
binary SHA-256, all allowlisted asset hashes, CDN freshness, MIME type and
cache behavior. Compile/run class, enum and two-actor terminal join fixtures
in the live browser; confirm no private source or unexpected file appears.

Never treat the successful **verify** job or uploaded Pages artifact as
deployment evidence. The **deploy job must execute** and the live origin
must be tested after publication.
