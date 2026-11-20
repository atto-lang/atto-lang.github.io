# Publishing and verifying engineering logs

Engineering logs are dated technical design discussions. They are not a released
language specification, and an architecture proposal is not proof of compiler support.

## Evidence policy

Before publishing or substantially revising a technical claim:

1. Label it **verified**, **experimental/in progress**, **proposed**, or
   **historical (as of the article date)**. Re-check old status tables when editing.
2. A claim of *compiler-verified* AttoLang code requires a compiler repository,
   immutable commit SHA, exact source example, invocation, and successful CI
   result. Without those, label the example *illustrative*.
3. Do not infer LLVM/GraalVM parity, GPU support, or guest-code AOT readiness from
   a marketing diagram, draft PR, code sample, or the existence of a repository.
4. Verify external citations against primary documentation, including versioned
   behavior and preview status. Private repositories cannot serve as publicly
   inspectable evidence for outside readers.
5. Explain both correctness and limitation: throughput, safety and zero-GC
   claims need workload and measurement context.
6. For Orleans-inspired virtual actor claims, distinguish logical identity from
   activation, explicit writes from persistence, admission from execution,
   default directory behavior from preview consistency features, and key identity
   from per-dispatch authorization.

## Article publishing checklist

- One descriptive `h1` per log. The expandable original prompt is a disclosure,
  not the page heading.
- Maintain article publication and modification dates, author, canonical link,
  and `TechArticle` structured data.
- Keep `/logs/` reverse chronological, and wire previous/next/archive links.
- Register each entry in `src/data/engineering-logs.mjs`; archive and RSS
  read the catalog, and tests verify its metadata against the Astro article.
- Every table-of-contents entry must resolve to a unique semantic section.
- Include alt text and dimensions for figures. Scrolling diagrams and code
  blocks must remain keyboard-focusable.
- If a source code fragment has not actually been compiled for a pinned AttoLang
  revision, describe it as a design example rather than a validated program.
- Do not introduce unreviewed executable HTML, third-party embeds or external
  scripts into engineering articles.

## Reproducing quality gates

From the repository root, with Node.js 22.20.0 and the pinned syntax-highlighter
submodule:

```sh
npm ci
npm test
python3 tests/log7_svg_test.py
npm run build
npm run test:blogs:build
npx playwright install --with-deps chromium firefox webkit
npm run test:blogs:browser
```

The rendered-output gate validates all nine published routes, their sitemap
entries, article metadata/JSON-LD, local assets and table-of-contents anchors.
The browser gate loads each log in Chromium, Firefox and WebKit at 375, 768, and 1440px,
checks keyboard-operated disclosures and horizontal overflow, and runs axe-core
WCAG serious/critical checks on mobile Chromium.

The `Validate marketing site` pull-request workflow runs these checks. A
separate `Manual independent blog audit` workflow is intentionally on-demand,
so ordinary PRs do not pay for duplicate builds.

## GitHub Actions capacity fallback

Use the current repository's PR runner first. If it cannot run for budget or
organization-policy reasons, a funded test repository may run an exact-tree
mirror **without cross-organization checkout credentials**. Verify the full Git
tree identity (including submodule gitlinks) and record the tested PR head,
source tree SHA, mirror tree SHA and workflow URL. A run on a similar branch,
a rebuilt patch, or a nonidentical tree is not evidence that the PR passed.
If an exact mirror cannot be established, report CI as unverified.

## Phase 3: compiler sample provenance and reproducible publishing

All twenty inventoried `<pre>` / highlighted examples across the
nine logs are enumerated in `src/data/engineering-log-examples.json`, with
source file, ordinal, example type, and verification status. The inventory is a
**truth-in-labeling mechanism**, not a substitute for compiling examples.

For a future `verified` example, record:
- Exact snippet bytes, immutable compiler commit, compiler build identity and backend.
- The versioned command or test fixture that ran the snippet.
- A passing CI run that checked this exact source, without a mirrored-tree mismatch.
- Whether the result includes JVM guest interpretation, Native Image runtime
  compilation, LLVM guest AOT, or actual guest-code AOT. Do not conflate these.
- A recheck and update of the inventory when the sample changes.

Until that evidence exists, source blocks remain classified as illustrative.
Marketing-site TypeScript/build/browser checks cannot establish compiler semantics.

## Dependency and performance verification

`npm ci` requires the committed npm v3 lockfile and the matching pinned
highlighter submodule. PR and Pages workflows pin GitHub Actions by full SHA,
verify the submodule gitlink, and audit high/critical advisories across both production and development tooling.
PR CI covers WebKit as well as Chromium/Firefox, tests three viewport sizes,
and attaches short-lived visual-review screenshots.

`npm run test:lighthouse` collects pinned Lighthouse 13.5.0 performance,
accessibility, best-practices and SEO scores for three representative pages.
Treat these as baseline observations, not established SLA gates. Chrome/headless
runner scores fluctuate with machine resources; promote any threshold only
after repeated measurements and review.

The Lighthouse CLI is pinned to 13.5.0 (Node.js 22.19+). This replaces an
older 12.x dependency chain carrying high-severity development advisories.
Lighthouse major-version scores are not directly comparable; retain the tool
version with every baseline report. CI uses immutable SHA-pinned Node24-native
GitHub Actions where available.

## Reviewed visual evidence and source identity

The site now checks approved screenshots against 18 tolerance-based visual
signatures (three engines × two widths × three routes), seeded from a verified
CI run. It also verifies the precise source digest of the only standalone
AttoLang compiler candidate in the engineering logs. See
[compiler evidence and visual baseline rules](ENGINEERING_LOG_EVIDENCE_AND_VISUALS.md)
for reproducibility, limitations, and how to review any baseline refresh.
