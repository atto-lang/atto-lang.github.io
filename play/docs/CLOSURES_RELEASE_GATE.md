# Candidate release gate: closures + functors

The site example has been executed as real generated Wasm against the private,
exact-source Rust compiler candidate. The website still uses its older vendored
compiler, and the example must stay under Language previews (Run disabled).

Candidate compiler SHA-256:
a04df154db79e5a82a1ca024e99f07a45e493bc77d20432c6ab92ebfec1bc426

Exact site sample Git blob:
5d3fa82fa5c554f2a92ad7c5bb75f43a7dc7c977

Private carrier execution:
https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43756005890

The successful run matched the complete Rust compiler source tree, exercised
the independently developed atto-source.wasm PR #13 verifier, compiled and ran
the exact playground sample (result 84), rejected mutable capture, nested
capture shadowing and escaped closures without emitting guest Wasm, and
confirmed compiler recovery after each rejection. The runner also passed 366
guest conformance cases, 329 native/Wasm artifact comparisons, and Chromium.

This is a provenance staging record, not a signed release receipt. No compiler
binary was vendored or republished by the record. To enable Run, obtain
independent PR #134 and site approval, independently approve public compiler
disclosure and the exact digest, configure protected main and GitHub Actions
Pages source, and stage a reviewed digest-pinned compiler binary plus ABI-compatible
browser runner. Dispatch the approved release on protected main and verify
the public-origin compiler digest and denylist in the live postflight.

Do not use a successful PR workflow to bypass the administrator's Pages
source/ruleset/environment protection requirements.
