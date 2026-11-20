# AttoLang naming-clearance evidence and release gates

**Working candidate:** AttoLang (not standalone Atto)  
**Audit date:** 2026-11-01  
**Disposition:** **PROVISIONAL — NOT GLOBALLY CLEARED**

This public evidence file is a research and decision ledger, **not** a trademark search opinion, an authorization to use the name in every jurisdiction, a legal conclusion, or proof that a domain/handle/package is available. The machine-readable source is [attolang-name-clearance.json](./attolang-name-clearance.json). Legal advice and official trademark results must be obtained outside this repository before claiming clearance.

## Evidence independently rechecked

| Finding | Evidence | Limits |
| --- | --- | --- |
| Italian `atto` means an act/deed and can mean fit/suitable | [Cambridge](https://dictionary.cambridge.org/us/dictionary/italian-english/atto) | Dictionary meaning does not clear dialect slang or trademarks |
| A functional programming language is already called Atto | [zesterer/atto](https://github.com/zesterer/atto) | Not necessarily an enforceable trademark |
| An actor-backed Go agent runtime uses Atto | [Go documentation](https://pkg.go.dev/github.com/tochemey/atto) | Different category and implementation; confusion needs separate evaluation |
| ATTO Technology claims registered ATTO marks for hardware/software | [Owner's trademark statement](https://www.atto.com/about-atto-technology/compliance/trademark-information/) | Specific goods and services matter; no blanket ban |
| U.S. registration 2680135 is associated with ATTO Technology | [Third-party record](https://trademarks.justia.com/763/12/atto-76312586.html) | Re-verify current status and goods directly in USPTO/TSDR |
| U.S. registration 2680136 is associated with ATTO Technology | [Third-party record](https://uspto.report/TM/76312590) | Re-verify current status and goods directly in USPTO/TSDR |

The [USPTO's confusion guidance](https://www.uspto.gov/trademarks/search/likelihood-confusion) says similarity and related offerings matter. Neither the presence of an ATTO mark nor appending “Lang” establishes a legal yes/no answer.

## Corrections to preliminary screening claims

- A list of 37 languages is a **target review roster**, not 37 completed native-speaker screenings. Native-speaker status is `pending` for every language; do not infer safety from lack of indexed search hits.
- Searches for `AttoLang` did not establish worldwide trademark availability, an available GitHub organization, or ownership of an existing similarly named organization.
- Unresponsive domains and missing package result pages are **not** registration-availability evidence. Treat exact-domain and package results as `unverified`.
- External aggregators identify U.S. ATTO registrations, but an official current-status search and a confusion assessment are still missing.
- The existing names **Atto** and **AttoLang** are not interchangeable. Assess both exact and phonetic variations.

## Launch decision checklist

1. Counsel reviews USPTO live marks, TSDR registration IDs **2680135/2680136**, confusingly similar marks, common-law usage, and intended goods/services (initially Nice Classes 9 and 42; evaluate others as needed).
2. Review EUIPO, UKIPO, WIPO Madrid and priority country registers through appropriate manual/authorized methods. WIPO [restricts automated querying](https://www.wipo.int/en/web/global-brand-database/terms_and_conditions) and its database is not a legal opinion.
3. Obtain qualified native-speaker screening of all 37 target languages, including dialect, slang, pronunciation, and near-homophones; record reviewers and dates without exposing personal information.
4. Verify domains with registrar/RDAP and GitHub/package handles with authoritative authenticated reservation checks; do not claim availability from 404s.
5. Receive recorded owner approval **after** supporting evidence and counsel's recommendation. Until then, branding is provisional.

## CI and source-handling policy

`npm test` validates ledger integrity and **fail-closed status only**: no CI run can certify trademark freedom or linguistic safety. All legal/registry gates remain pending.

Use the existing source-repository Actions first. A job with `steps=[]`/`null` is a runner-admission failure, not a pass or fail of code. Only if source Actions admission fails, evaluate an **authorized private** destination with funded Actions minutes; mirror the exact permitted Git tree without cross-org tokens, verify source/destination tree identity and submodules/LFS, and execute the destination's own workflow with minimal read permissions. Never mirror private code into a public repository and never add secrets or unreviewed workflows. That fallback is unnecessary for this public naming-only change if the source CI executes.

## Scoped registration findings (research only; no legal clearance)

- [U.S. ATTO registration 2680135 / serial 76312586](https://trademarks.justia.com/763/12/atto-76312586.html) is reported for **specific data-management/storage hardware and software** and also lists historical Class 37 and 42 services. A broad claim that it covers all software would be misleading. This is a third-party index; the official current status, cancellations and current exact identification must be re-read in USPTO TSDR.
- [U.S. ATTO registration 2680136 / serial 76312590](https://uspto.report/TM/76312590) is reported as renewed with a **partial Section 8 cancellation in 2022**. The original identification and the current surviving services may differ; counsel must verify the exact current register from USPTO before assessing relatedness.
- The [mark owner's public list](https://www.atto.com/about-atto-technology/compliance/trademark-information/) confirms that the company claims ATTO as a registered mark for certain computer software and hardware. This does not itself decide AttoLang's registrability.
- [USPTO's search guidance](https://www.uspto.gov/trademarks/search/federal-trademark-searching) explicitly emphasizes related goods/services, variations in sound and spelling, and multiple search passes. Class numbers alone do not answer confusion.

## Evidence workflow (schema v2)

Each gate starts as `pending`. A reviewer may mark a **specific gate** `documented` only with HTTPS evidence, observation date, defined scope, a reviewer identifier/role and a scoped conclusion. Legal-confusion conclusions require a qualified trademark-counsel role. Individual languages require separate native-speaker evidence; domain and registry results require per-identifier verification. No combination of machine-readable statuses makes the name **globally cleared**.

`ready_for_owner_decision` is only an administrative routing status after documentary prerequisite gates, **not** a legal conclusion. The owner must review the underlying originals and receive counsel's opinion separately. CI validates shape and fail-closed conditions, not the authenticity, ownership, freshness, accuracy or legal sufficiency of a supplied URL. Changing the ledger to claim global clearance is deliberately rejected.

## November 2, 2026 — Official-record retrieval and hardening follow-up

Attempted official USPTO TSDR status views for **76312586 / 2680135** and **76312590 / 2680136** via the public interface. Only the general page shell was retrievable through the available browsing method; the two case-specific current status, ownership and surviving goods/services were **not returned**. The USPTO [explains how to inspect a registration in TSDR](https://www.uspto.gov/trademarks/apply/check-status-view-documents), and [requires a registered key for programmatic TSDR API access](https://www.uspto.gov/trademarks/apply/check-status-view-documents/trademark-bulk-data). Do not imply the current legal status or official goods identification was confirmed.

The new `official_us_record_checks` field records both attempts with `verification_status: "not_verified"`. It cannot be promoted to `verified_by_human` without scoped official-record evidence, a reviewer and an observed status. The `formal_us_search` gate cannot complete before both statuses have been reviewed.

Evidence URLs are syntax-screened to reject HTTP, URL credentials, literal IP addresses, test/internal domains and credential-like query parameters; evidence dates must not be in the future or more than 90 days older than the ledger's audit date. **These checks do not prove URL authenticity or underlying assertions**, so legal opinions, ownership, and native-speaker signoffs still require independent review. A stated `not_cleared` conclusion cannot be promoted to the owner-decision-ready workflow.

### Operational governance

The public repository's `main` branch was observed with `protected: false` and no active rulesets during this review. The connected GitHub integration supports ruleset reads but **not branch protection or ruleset writes**. An organization administrator must configure required PR reviews, stale-review dismissal, code-owner review if applicable, required exact-head check `Validate marketing site / build`, restricted bypass permissions, and a guarded merge process. CI validation is independent of this branch-protection configuration.

This marketing repository is **public** and its Actions have successfully executed stepful builds; do not copy code to a separate organization merely because a cross-org mirroring strategy exists. If a future workflow genuinely fails runner admission, assess Actions minutes and destination authorization first; no private source may be mirrored without explicit separate authorization.
