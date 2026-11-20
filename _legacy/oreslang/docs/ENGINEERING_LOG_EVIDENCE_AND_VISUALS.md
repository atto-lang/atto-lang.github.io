# Engineering-log compiler and visual evidence

The AttoLang marketing repository contains architecture notes, not a released
compiler specification. Publishing a code-looking block does not mean that
GraalVM, LLVM, or a future WebAssembly backend accepts it.

## Classification of the sixteen logged examples

The versioned inventory at `src/data/engineering-log-examples.json`
differentiates:
- **11 non-compiler artifacts:** diagrams, shell commands, TOML examples,
  documentation templates and pseudocode. They are not executable AttoLang.
- **1 proposed language feature:** Log 001's `@Realtime` form.
- **1 example requiring external imports:** Log 002's file header/import.
- **1 intentionally invalid import:** Log 002's browser/server conflict.
- **1 style illustration:** Log 004's non-normative naming example.
- **1 standalone candidate:** Log 007's `calculate(int x)` function.

Only a genuine compiler-executed source example can acquire
`compilerVerified: true`. The catalog currently asserts **zero** such
claims. Nothing about actor pipeline gradients, backends, guest-code AOT,
zero-GC, or network access can be inferred from this inventory.

## Candidate identity and compiler verification

Log 007's exact source text (after decoding HTML `&#123;` / `&#125;`) has:

```text
SHA-256 26d17ee717f453a1c6d08d53a14e05b262cfe3cbc98c919b0c907f3dea5fe175
```

The public test recomputes this digest on every PR, so even an innocuous
formatting change invalidates the compiled-example candidate until the
private compiler evidence is rerun.

A separate **private compiler test** must verify the exact bytes, parse,
typecheck and execute a wrapper that calls `calculate(21)` and checks output
`42`. A passing JVM interpreter/Truffle result certifies only that profile;
it cannot certify LLVM, Native Image guest-code AOT, other architectures or
a public language specification. Record an immutable compiler commit, exact
test command, execution mode, and successful run before upgrading status.

No private compiler source, logs, tokens, or tests should be copied into
public repository artifacts. The compiler repository's deny-by-default
source-mirroring policy takes precedence over suggested CI fallback
locations: use no external organization unless that exact **private**
destination was separately approved on a trusted protected branch.

## Reviewed visual baselines

The archived, human-reviewed seed consists of **18 actual PNG screenshots**,
covering Chromium, Firefox and WebKit × widths 375 and 1440 × archive,
Log 006 and Log 007. The baseline manifest records the immutable source
commit, successful CI run, artifact ID and each original PNG SHA-256.

`tests/visual-baselines.json` preserves a zlib-compressed 32 × 24 RGB
pixel signature for each seed screenshot. On every browser PR run,
`tests/blog-browser.mjs` captures the same UI states, compares those
signatures using an absolute mean/color-cell tolerance and fails on
substantial visual drift. This is intentionally **not a pixel-perfect
snapshot guarantee**: font antialiasing and browser patch differences are
tolerated. Full-size PNG captures remain available as short-lived
`browser-visual-review` CI artifacts for manual inspection.

To change an approved baseline:
1. Inspect the full-resolution artifact in all three engines and viewports.
2. Resolve unintended visual differences in CSS rather than widening
   thresholds or masking failures.
3. Generate a new seed from an independently successful, exact-source
   validation run, recording its artifact and source commit.
4. Update the baseline manifest in a reviewed PR; ensure mismatch
   detection tests themselves still fail closed.
5. Keep the baseline-generator script versioned with the manifest.

### Reviewed single-image navigation update (October 22, 2026)

The original [visual seed run 38948068851](https://github.com/ores-truffle-oreslang/ores-truffle-oreslang.github.io/actions/runs/38948068851) remains the source of truth for **17 of 18** screenshots. The site's mobile menu has since deliberately gained two links, `licenses` and `comparisons`; those links are visible in the full-size WebKit 375 px logs-archive screenshot, but absent from the original baseline. A PR-head [validation run 39840069637](https://github.com/ores-truffle-oreslang/ores-truffle-oreslang.github.io/actions/runs/39840069637) exercised the page's keyboard/navigation/overflow and other browser checks and failed only the stale `webkit-375-archive.png` visual baseline (15 significant cells vs allowed 12).

The actual 375×900 screenshot from that run's [browser-visual-review artifact 12452822497](https://github.com/ores-truffle-oreslang/ores-truffle-oreslang.github.io/actions/runs/39840069637/artifacts) was compared visually with the original seed artifact 12067237575, including menu labels and layout. After review, **only that one screenshot's original SHA-256 and 32×24 RGB sample** were refreshed. No visual acceptance thresholds were changed; all other baseline signatures remain identical. `tests/visual-baselines.json.reviewedOverrides` pins the exact source commit, workflow run, artifact ID and review rationale; the baseline unit test explicitly validates this exception. Final CI on the updated PR head must still pass the unchanged visual gate before merge.

A past seed artifact may expire. The compact signatures and provenance
remain in Git, but new baselines must be seeded from a fresh reviewed run.

The visual snapshot gate complements, but cannot replace, keyboard,
WCAG, overflow, semantic HTML, Lighthouse and canonical-link tests.
