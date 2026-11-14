---
layout: whitepaper
title: "AttoLang Technical Papers — Editorial and Graphics Audit"
permalink: /whitepapers/AUDIT.html
---

# AttoLang Technical Papers: Editorial and Graphics Audit

**Audit snapshot:** 10 November 2026 · Series 0.4  
**Scope:** Papers 01–11, the landing page, the individual-paper layout, SVG figures, editorial index, and structural validator.

## Executive result

The first eleven papers now share a consistent rendering system and each has an original, editable SVG architecture figure. The content was checked for accidental claims of full implementation, backend parity, zero-GC completion, durable actor readiness, production-grade tenant isolation, and measured performance. Those claims remain explicitly scoped or identified as goals.

This is an editorial and documentation audit. It is not a certification of the underlying compiler or runtime implementations.

## Findings and changes

| Area | Finding | Change |
|---|---|---|
| Individual paper rendering | The index was styled, but individual Markdown pages had no shared editorial layout. | Added the `whitepaper` Jekyll layout, consistent navigation, typography, tables, code blocks, callouts, and responsive behavior. |
| Technical graphics | The papers had no original architecture figures. | Added eleven source-controlled SVG diagrams, one per paper, with accessible titles, descriptions, alternative text, and captions. |
| Paper 01 example | A new class example would have been easy to write in syntax not admitted by the published browser subset. | Kept the known-supported arithmetic/function example and clarified which syntax belongs to the documented browser subset versus the broader language design. |
| Memory claims | A bounded allocator could be mistaken for deterministic reclamation. | Preserved the explicit statement that the current browser bump heap does not free individual objects and does not prove end-to-end zero-GC. |
| Actor claims | Browser workers could be mistaken for a native OS sandbox or the complete distributed actor runtime. | Kept the actor limits and FIFO behavior scoped to the public browser implementation; stated that a worker is not an OS isolation boundary. |
| Portability claims | A five-backend target could be mistaken for proven parity. | Retained the requirement for exact-head guest fixtures and backend-specific receipts; no blanket parity statement is made. |
| Security claims | Language and actor isolation could be conflated with tenant or process isolation. | Kept language safety, actor isolation, VM isolation, and OS sandboxing as distinct layers. |
| Performance claims | Methodology could be mistaken for measured performance. | Explicitly states that this paper publishes no benchmark result or performance-superiority claim. |

## Graphics inventory

The SVG files in `assets/` are authored as editable vector source and contain no external image, font, script, or embedded HTML dependencies.

| Paper | Figure |
|---|---|
| 01 | Semantic layers: language contract → compiler → runtime → host platform |
| 02 | Compiler pipeline: source → front end → semantic IR → lowering → validation |
| 03 | Ownership lifecycle: owner → borrow → suspension validity → reclamation |
| 04 | Actor flow: publisher → bounded mailbox → actor turn → supervisor |
| 05 | Backend model: canonical semantics → backend families → guest conformance |
| 06 | Static guarantees: typing → refinements → ownership → effects |
| 07 | Execution context: OS thread → carrier scheduler → task context → actor activation |
| 08 | Upgrade protocol: fence → quiesce/persist → migrate/activate → verify/rollback |
| 09 | Security layers: identity → capabilities → isolation → quotas/control |
| 10 | Evidence chain: exact source → guest execution → measurement → receipt |
| 11 | Structured task scope: parent ownership → child tasks → cleanup → completion |

The diagrams are explanatory models. Their presence does not imply that every component is implemented or conformant on every target.

## Published baseline and deployment receipt

The collection was merged as [PR #34](https://github.com/atto-lang/atto-lang.github.io/pull/34) and deployed on 10 November 2026:

- Published source commit: `28625f0021b003487f02297bf11f8b8d79482e8f`; Git tree `8cc1783197c1057af931a411aa368caf0185da58`.
- [Post-merge source/Jekyll validation](https://github.com/atto-lang/atto-lang.github.io/actions/runs/42894659069): executed and passed on that source commit.
- [GitHub Pages build and deployment](https://github.com/atto-lang/atto-lang.github.io/actions/runs/42894656745): build, deploy, and report jobs succeeded for the same commit.
- External HTTPS checks confirmed the landing page, eleven individual paper URLs, eleven SVG figures, and the stylesheet were accessible.
- The [post-merge receipt](https://github.com/atto-lang/atto-lang.github.io/pull/34#issuecomment-6778395297) records the scope of those checks.

This establishes a live technical-documentation publication. It is not proof of compiler-backend parity, zero-GC execution, measured performance, or security certification.

## Additional deployment-path hardening

A subsequent audit identified a cross-workflow regression risk: the manually approved playground release previously staged only `play/**` and would overwrite the Pages artifact, potentially removing `/whitepapers/`. The hardening change in [PR #35](https://github.com/atto-lang/atto-lang.github.io/pull/35) addresses this by:

1. Building and validating the Jekyll documentation separately from playground guest tests.
2. Explicitly allowlisting only reviewed, rendered documentation HTML, CSS, SVGs, and the root page in the protected release package.
3. Recording asset sizes and SHA-256 digests in the release manifest.
4. Excluding unknown assets and refusing symlinks, active documentation markup, and unsafe SVG constructs.
5. Preserving the compiler binary's independent SHA-256 approval and manual-disclosure gates.
6. Checking the staged playground and documentation together before uploading the artifact.

A successful PR packaging run proves the staging contract, not that the manually approved deployment was executed. The current live-site receipt remains tied to the published baseline above until a newer Pages deployment is independently verified.

## Accessibility and editorial improvements

The paper index's roadmap now begins at paper 12. Every paper exposes a full-resolution SVG link so dense architecture figures can be inspected on smaller screens. Keyboard users have skip links and visible focus states; links to the eleven papers have distinguishable text. These features are covered by source and rendered-page checks. Full WCAG certification and physical-device testing remain separate work.

## Verification policy

Keep CI receipts tied to the exact source head and Git tree. Do not treat `steps=[]` or `steps=null` as evidence of test execution. Maintain separate labels for source validation, Jekyll rendering, packaged-release execution, production deployment, and compiled guest conformance. Document actual deployment identities after every release.
