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

## Latest exact-head source and render evidence

The current PR head was checked on 10 November 2026:

- Commit: `166f8eb9adaf9b907c044898cf514357788a5f6d`
- Git tree: `fa383823c6b0269ed038de55fc0b39497f872444`
- Workflow: AttoLang white-paper validation, run #20
- Result: successful; exact-head checkout, source validation, Jekyll build, and rendered-output validation all executed.
- Source result: 28 files, 14 Markdown documents, 11 accessible SVGs, unique permalinks, local links, and landing-page navigation.
- Render result: 27 required assets and 11 paper pages using the shared layout; figure markup and CSS verified.
- Checkout action: `actions/checkout@v7.0.1`; run completed without the previous Node 20 deprecation warning.

This is pull-request build evidence, not a production deployment receipt.

## Automated checks

The documentation validator now checks:

- Required paper, layout, style, and figure assets.
- Markdown front matter, shared layout declaration, and unique permalinks.
- Balanced fenced code blocks and local Markdown links.
- One figure per paper, non-empty alternative text, lazy loading, and the corresponding asset.
- SVG image roles, title and description elements, and absence of scripts, foreign objects, or external references.
- Landing-page links and layout rendering hooks.

The GitHub Actions workflow checks out the exact PR head and emits both commit and tree identity. The Node source validator checks structure, metadata, asset accessibility markers, and local link targets. A second test builds the site with the official Jekyll Pages builder and checks rendered page routes, shared layout application, figure markup, and emitted assets. Run #20 is a successful exact-head example of both phases. The GitHub Pages build and deployed-page inspection remain separate gates. A workflow definition or successful run on an earlier commit is not evidence for a newer head.

## Remaining publication gates

1. The latest exact-head documentation workflow must pass.
2. Independent review and repository branch rules must be satisfied.
3. GitHub Pages must build and deploy the reviewed revision.
4. The live landing page and all eleven direct paper URLs must be checked over HTTPS, including mobile layout and figure loading.

Until those gates pass, describe the papers as authored on the PR branch, not published on the live site.
