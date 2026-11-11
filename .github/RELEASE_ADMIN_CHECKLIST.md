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
