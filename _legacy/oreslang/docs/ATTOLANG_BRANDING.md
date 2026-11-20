# AttoLang public brand and compatibility policy

The current public language name is **AttoLang** (capital A and L). The existing GitHub organization and historical `oreslang-*` repository names are **not** the public product name. Do not rename them as part of marketing cleanup.

- Use **AttoLang** in page titles, descriptions, introductions, visible labels, screenshots, RSS, social previews, and current explanatory prose.
- Write new language source, examples and fixtures with `.atto` where the selected compiler/toolchain supports it. Historical `.ores` fixtures and executables must not be silently renamed: validate compatibility and migrate through explicit tooling work.
- Preserve existing `oreslang` CLI and compiler commands, `ORESLANG_*` environment variables, syntax-highlighter IDs, JSON schema keys, internal URLs, historical anchors, and the **OresVM** runtime name until independent versioned migrations ship.
- Do not rewrite quoted historical prompts, immutable benchmark receipts, legal terms, or external citations merely to eliminate the old text.
- Public sample code remains illustrative unless exact compiler and backend evidence is linked. Branding must not imply unsupported runtime parity.
- New public assets should use the checked-in `attolang-wordmark.svg`; the favicon is a simple monochrome o-with-caret companion.
- `social-preview.svg` is the vector master. `scripts/build-brand-assets.mjs` generates `public/brand/attolang-social.png` from that checked-in source, along with monochrome PNG wordmarks and the 180px icon. The site publishes that raster as its Open Graph/Twitter image. Every production build must prove PNG integrity and dimensions; the post-deploy live check independently verifies its HTTP response, not merely the source file.

Run `npm test`, `npm run build`, site/RSS checks, and real browser accessibility/visual checks against the exact PR head. A zero-step or skipped CI run is **not** evidence of passing tests.

## Naming clearance boundary

**AttoLang is a provisional public display name, not a globally cleared trademark.** Do not assert exclusive ownership, international trademark availability, language-by-language slang safety, domain availability, or readiness to launch without completed review gates. See [the naming-clearance evidence ledger](./ATTOLANG_NAME_CLEARANCE.md); its CI tests check evidence structure and policy only, not legal rights. A gate can be marked documented only with a scoped evidence receipt and reviewer role; CI may never declare global trademark clearance.
