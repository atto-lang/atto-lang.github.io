# AttoLang Evidence Control — signed guest receipt protocol

## Signed guest attestation verification (v1; source-free, still NOT_CERTIFIED)

The new **offline** `tools/verify-signed-guest-receipt.mjs` verifies a separately authorized,
Ed25519-signed **guest-execution claim** against a fresh, previously collected advisory
metadata snapshot and an **operator-controlled trust policy**. Unlike the collector, this
verifier can check a cryptographic signature, but it **does not create receipts, sign data,
re-run the guest, fetch GitHub data, or issue merge/release certification**. Claims that
actual guest programs executed must originate from a separately reviewed, permitted
attestor that independently checked execution logs and artifact bytes.

Run locally (all files are private operator inputs; do not check populated files into Pages):

```sh
node tools/verify-signed-guest-receipt.mjs \
  --receipt ./signed-guest-receipt.json \
  --metadata ./advisory-metadata-snapshot.json \
  --trust ./private-operator-trust-policy.json
```

The signed envelope schema is `schemas/signed-guest-receipt.v1.schema.json`; the
local policy schema is `schemas/guest-trust-policy.v1.schema.json`. Both reject
unknown properties. The envelope uses `algorithm: Ed25519` and a registered
`key_id`, and signs the following **exact UTF-8 bytes** with Ed25519:

```
AttoLang/guest-execution-receipt/v1\n + JSON.stringify(payload with top-level keys sorted in ascending UTF-16 lexical order)
```

The payload is flat with string values only, so there is no nested JSON
canonicalization ambiguity. This is a deliberate versioned contract, **not** an
assertion of RFC 8785/JCS compatibility. Signature bytes are represented by
strict canonical base64 and must decode to exactly 64 bytes. Key material is **never
shipped**; tests generate ephemeral Ed25519 keys only in process memory. The
validator supports source- or mirror-origin CI with exact source tree, PR head,
mirror tree/commit, workflow/run/job and attempt, runner, artifact digest,
contract version and guest binary/log/result SHA-256 bindings.

Trust policy must be independently provisioned and protected, and contains:
Ed25519 SPKI public key PEM, key IDs, an authorized `guest-execution-attestor` role,
`attestor_login` distinct from the PR author, validity windows, revocation,
allowed repository/backend/contract scopes, a newly generated unpredictable
64-hex verifier challenge (`challenge_nonce`), and independently managed
`seen_receipt_ids` / `revoked_receipt_ids`. The verifier checks these values and
receipts expire after no more than 24 hours; source metadata must be within
72 hours, with the CI artifact unexpired. **The CLI does not atomically consume
nonces or persist a replay ledger**: a trusted external coordinator must issue
unique challenges, atomically record consumed receipt IDs, and provide fresh
revocation/trust policy state before relying on repeated verification. A receipt
can be replayed if that coordination is omitted.

`verifyFiveBackendSignedParity` verifies each backend independently, rejects
unsigned or conflicting receipts, duplicate backend/receipt IDs, and mismatched
contract versions. It produces `INCOMPLETE_SIGNED_GUEST_ATTESTATIONS` until all
five accepted claims exist; alignment is labeled
`FIVE_BACKEND_SIGNED_ATTESTATIONS_ALIGNED`, **never release certified**.

**Limitations / security boundary**: Signature validation proves the claimed
bytes were signed by a configured key, not that the runtime genuinely executed
or that source/mirror authorization was granted. The verifier accepts an external
snapshot; it does not recheck live GitHub head/approval state, protect key custody,
prove any private runner admission, or substitute for independent source-side
validation. Even a signed guest receipt returns `merge_readiness: ADVISORY_ONLY`
and `release_certification: NOT_CERTIFIED`. Public deployment remains blocked
by [Pages security issue #5](https://github.com/atto-lang/atto-lang.github.io/issues/5).

```sh
node --test tests/*.test.*
```
