<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/attolang-wordmark-light.svg" />
    <img src="./public/attolang-wordmark.svg" alt="AttoLang" width="560" />
  </picture>
</p>

# AttoLang marketing site

Marketing site for [AttoLang](https://github.com/ores-truffle-oreslang), built with **Astro**.

Official [brand assets](https://ores-truffle-oreslang.github.io/brand/) include the
black and white SVG wordmarks, build-generated transparent PNGs, favicon, and
1200 × 630 social preview. See [brand and rename guidance](docs/ATTOLANG_BRANDING.md).
AttoLang was formerly named Oreslang; existing repository and tooling paths
are retained for backward compatibility during migration.

## Local development

Requires Node.js 22.20.0 or newer.

```bash
git clone --recurse-submodules https://github.com/ores-truffle-oreslang/ores-truffle-oreslang.github.io.git
cd ores-truffle-oreslang.github.io
npm ci
npm run dev
```

If the repository was already cloned:

```bash
git submodule update --init --recursive
```

Build and validate:

```bash
npm run build
```

The homepage is intentionally both a landing page and a table of contents:

- nav links scroll to `/#about`, `/#examples`, `/#problem-spaces`, and `/#links`
- section headings open the dedicated `/about/`, `/examples/`, `/problem-spaces/`, and `/links/` pages


## Engineering logs and publishing

Engineering-log titles, dates, summaries and archive ordering live in
`src/data/engineering-logs.mjs`. The archive and
[`/rss.xml`](https://ores-truffle-oreslang.github.io/rss.xml) use that catalog,
and CI checks that it matches the metadata inside the individual posts.

After editing a log or publishing a new one, run:

```sh
npm test
npm run build
npm run test:blogs:build
npm run test:site:build
npm run test:rss:build
npx playwright install --with-deps chromium firefox
npm run test:blogs:browser
```

See [engineering-log publication standards](docs/ENGINEERING_LOG_PUBLICATION.md)
for verification, accessibility, and evidence requirements.

## AttoLang syntax highlighting

Syntax highlighting lives in the pinned submodule at
`vendor/html-js-css-syntax-highlighter`, backed by:

https://github.com/ores-truffle-oreslang/html-js-css-syntax-highlighter

The site consumes its Astro adapter from
`@ores-truffle-oreslang/html-js-css-syntax-highlighter/adapters/astro`.

To intentionally update the grammar used by the site, advance the submodule pointer
to a tested highlighter commit and commit that pointer change here.

## Software licenses

The website publishes a [licenses page](/licenses/) with the custom Lima 27
source-available license and exclusions. It is not OSI-approved or a free-software
license; the page does not automatically apply Lima 27 to compiler repositories,
third-party contributions, or previously licensed releases. Adoption requires
an express notice by each authorized rights holder.

## Deployment

`.github/workflows/deploy.yml` checks out submodules, runs the highlighter's own test
suite, builds Astro, and deploys `dist/` to GitHub Pages.
`public/.nojekyll` explicitly disables Jekyll processing.

## Reproducible website verification

The source repository commits `package-lock.json` and pins its GitHub Actions
to immutable commit SHAs. Use Node 22.20.0 and check out the exact pinned syntax
highlighter submodule before installing dependencies. Use `npm ci` (not
`npm install`) to build the same dependency tree as CI.

The PR workflow checks NPM package integrity, the exact submodule gitlink,
read-only build permissions, high/critical production dependency advisories,
static page references, all ten engineering logs, and browser behavior on
Chromium, Firefox and WebKit. High/critical advisories are gated for the
complete dependency tree (not only production packages); moderate advisories
remain visible in npm's report.

```sh
npm ci
npm test
npm run build
npm run test:blogs:build
npm run test:site:build
npm run test:rss:build
npx playwright install --with-deps chromium firefox webkit
npm run test:blogs:browser
npm run test:lighthouse
```

Lighthouse reports are **baselines**, not proof that performance targets pass:
the pinned Lighthouse 13.5.0 runner measures the homepage, archive, and actor-LLM
article, saves machine-readable JSON, and prints scores. PR CI retains these
reports and cross-browser visual review captures for seven days. The screenshots
are also checked against 18 reviewed, tolerance-based pixel signatures.

See [engineering-log publication standards](docs/ENGINEERING_LOG_PUBLICATION.md)
and [example evidence inventory](src/data/engineering-log-examples.json), and
[compiler/visual verification policy](docs/ENGINEERING_LOG_EVIDENCE_AND_VISUALS.md).

## Engineering policy: no Python

Python is prohibited in the `ores-truffle-oreslang` GitHub organization, including scripts, build tools, tests, CI, automation and documentation examples that execute Python. Existing Python implementations must be replaced with equivalent **Rust** implementations while preserving behavior, security properties and test coverage. Do not add `.py`, `.pyi`, `.ipynb`, Python dependency manifests, `python`/`python3` commands, `pip`, `pytest`, `poetry`, `uv` or `actions/setup-python` to project workflows. Rust replacements should pass `cargo fmt`, `cargo clippy` and `cargo test`. Explanatory references to this prohibition are acceptable. The language-specific AttoLang compiler backends are not required to be rewritten in Rust solely because they are implemented in Java, C/C++ or other non-Python languages.

## RSS validation

Use `npm run test:rss:build` after a site build. The primary RSS/sitemap validator is now a Rust XML parser at `tools/rss-validator/`, with namespace, RFC 2822 date, canonical-link, size and malformed-feed checks. CI uses a pinned Rust 1.91.0 compiler. The earlier Python validator remains temporarily as a compatibility reference while tests establish parity; it is no longer part of the normal RSS script.

## Repository ownership and legacy-exit decision (2026-11-08)

**Current home:** `ores-truffle-oreslang/ores-truffle-oreslang.github.io`. **Status: EXPLICIT HOLD — not an approved transfer.** The language's current public name is **AttoLang**; preserve the old `oreslang-*` namespace and `.ores` compatibility where applicable. Do not rename or transfer this repo on the basis of a branding change.

- **Belongs here:** historical source-organization GitHub Pages site, redirects and compatibility documentation.
- **Does not belong here:** assuming Pages URLs automatically redirect after a repository transfer.
- **Organizational boundaries:** [atto-lang](https://github.com/atto-lang) is for the AttoLang language, compilers, ecosystem tools and portable libraries; [atto-co](https://github.com/atto-co) independently governs hosted commercial infrastructure. This is a **legacy hold**, not a default permanent home and not a direct `atto-co` candidate. Similarly named repositories in destination organizations are distinct Git identities unless proven transferred.

**Required next decision:** a named source owner and independent reviewer must explicitly select **(a) approved transfer, (b) archive, or (c) time-bounded compatibility exception with review date**, as defined in the private [migration plan #25](https://github.com/ores-truffle-oreslang/.github/pull/25). Record the decision, exact source HEAD SHA/tree, numeric ID, branch/ruleset protections, release/PR history, package and Pages consumers, GitHub Apps, secrets, Actions runners, webhooks, visibility and rollback in [coordination issue #26](https://github.com/ores-truffle-oreslang/.github/issues/26). No private source mirror, automatic renaming or unapproved org transfer. If transfer is later approved, preserve GitHub ID/history and check destination access/CI, with nonzero executed steps; `steps=[]`/`null` is `NOT_EXECUTED`. Keep any Pages redirects and external links explicit and independently checked.
