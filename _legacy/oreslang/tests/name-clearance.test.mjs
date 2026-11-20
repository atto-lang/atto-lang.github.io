import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateNameClearance } from "../scripts/name-clearance-validation.mjs";

const load = () => JSON.parse(readFileSync(new URL("../docs/attolang-name-clearance.json", import.meta.url), "utf8"));
const validEvidence = {url: "https://www.uspto.gov/trademarks/search/federal-trademark-searching",
  checked_on: "2026-11-02", summary: "Sample structural evidence only; not an authenticated legal clearance decision."};
const documentGate = (data, name, role) => {
  data.decision_gates[name] = {
    status:"documented", evidence:[structuredClone(validEvidence)], reviewed_at:"2026-11-02",
    reviewer_role:role, reviewer_id:"test-reviewer-1", scope:"Example scoped review only",
    conclusion:"risk_accepted_in_scope",
  };
};

test("ledger is explicitly provisional with 37 language targets and independently documented collisions", () => {
  const data = load();
  assert.equal(validateNameClearance(data), true);
  assert.equal(data.languages.length, 37);
  assert.ok(data.languages.every(x => x.native_speaker_review === "pending"));
  assert.ok(Object.values(data.decision_gates).every(x => x.status === "pending"));
});

test("false global clearance, spoofed status and bypassed review are rejected", () => {
  const d = load();
  assert.throws(() => validateNameClearance({...d, status:"globally_cleared"}));
  assert.throws(() => validateNameClearance({...d, status:"ready_for_owner_decision"}));
  const copied = structuredClone(d);
  copied.decision_gates.counsel_confusion_review.status = "documented";
  assert.throws(() => validateNameClearance(copied), /approval|evidence/u);
});

test("a properly documented individual gate can advance without claiming clearance", () => {
  const d = load();
  documentGate(d, "counsel_confusion_review", "qualified_trademark_counsel");
  assert.equal(validateNameClearance(d), true);
  assert.equal(d.status, "provisional_not_cleared");
  const bad = structuredClone(d);
  bad.decision_gates.counsel_confusion_review.reviewer_role = "random_actor";
  assert.throws(() => validateNameClearance(bad), /review role/u);
  const noLink = structuredClone(d);
  noLink.decision_gates.counsel_confusion_review.evidence[0].url = "http://example.com";
  assert.throws(() => validateNameClearance(noLink), /supporting document/u);
});

test("dangerous owner signoff, invented language approvals and unsupported package availability fail closed", () => {
  const d = load();
  documentGate(d, "owner_signoff", "authorized_owner");
  assert.throws(() => validateNameClearance(d), /cannot precede/u);
  const language = load();
  language.languages[0].native_speaker_review = "documented";
  assert.throws(() => validateNameClearance(language), /native-speaker evidence/u);
  const pkg = load();
  pkg.identifiers.packages.npm = "available";
  assert.throws(() => validateNameClearance(pkg), /registry record/u);
});

test("duplicate language/source IDs or removed trademark evidence are rejected", () => {
  const d = load();
  d.languages.push(structuredClone(d.languages[0]));
  assert.throws(() => validateNameClearance(d), /duplicate language/u);
  const m = load();
  m.verified_public_findings = m.verified_public_findings.filter(x => x.id !== "atto-us-reg-2680136");
  assert.throws(() => validateNameClearance(m), /missing documented collision/u);
});

test("candidate remains provisional in branding policy and audit report", () => {
  const policy = readFileSync(new URL("../docs/ATTOLANG_BRANDING.md", import.meta.url), "utf8");
  const report = readFileSync(new URL("../docs/ATTOLANG_NAME_CLEARANCE.md", import.meta.url), "utf8");
  assert.match(policy, /provisional public display name/u);
  assert.match(report, /PROVISIONAL — NOT GLOBALLY CLEARED/u);
  assert.match(report, /steps=\[\].*null/u);
  assert.match(report, /partial Section 8 cancellation/u);
});

test("official registration lookup is an attempt, not a verified current registration status", () => {
  const d = load();
  assert.deepEqual(d.official_us_record_checks.map(x => x.serial_number),
    ["76312586", "76312590"]);
  assert.ok(d.official_us_record_checks.every(x => x.verification_status === "not_verified"));
  const forged = structuredClone(d);
  forged.official_us_record_checks[0].verification_status = "verified_by_human";
  assert.throws(() => validateNameClearance(forged), /registration status/u);
  const mismatched = structuredClone(d);
  mismatched.official_us_record_checks[0].registration_number = "9999999";
  assert.throws(() => validateNameClearance(mismatched), /registration status/u);
  const generic = structuredClone(d);
  generic.official_us_record_checks[0].official_url = "https://www.uspto.gov/";
  assert.throws(() => validateNameClearance(generic), /registration status/u);
});
test("fake and private evidence endpoints, secrets and future timestamps are rejected", () => {
  const unsafe = [
    "https://example.com/pretend-clearance", "https://localhost/status",
    "https://127.0.0.1/status", "https://example.internal/status",
    "https://evil.example/status", "https://user:password@www.uspto.gov/records",
    "https://www.uspto.gov/search?api_key=sensitive",
    "https://www.uspto.gov.evil.test/records", "http://www.uspto.gov/records",
  ];
  for (const url of unsafe) {
    const d = load();
    documentGate(d, "counsel_confusion_review", "qualified_trademark_counsel");
    d.decision_gates.counsel_confusion_review.evidence[0].url = url;
    assert.throws(() => validateNameClearance(d), /supporting document/u, url);
  }
  const future = load();
  documentGate(future, "counsel_confusion_review", "qualified_trademark_counsel");
  future.decision_gates.counsel_confusion_review.evidence[0].checked_on = "2099-01-01";
  assert.throws(() => validateNameClearance(future), /supporting document/u);
  const stale = load();
  documentGate(stale, "counsel_confusion_review", "qualified_trademark_counsel");
  stale.decision_gates.counsel_confusion_review.evidence[0].checked_on = "2020-01-01";
  assert.throws(() => validateNameClearance(stale), /supporting document/u);
  const auditFuture = load();
  auditFuture.as_of = "2099-01-01";
  assert.throws(() => validateNameClearance(auditFuture), /future/u);
});
test("formal US gate cannot be completed using generic guidance instead of both official records", () => {
  const d = load();
  documentGate(d, "formal_us_search", "trademark_researcher");
  assert.throws(() => validateNameClearance(d), /human-reviewed official registration records/u);
});

test("negative evidence fixtures do not contaminate later test cases", () => {
  const bad = load();
  documentGate(bad, "counsel_confusion_review", "qualified_trademark_counsel");
  bad.decision_gates.counsel_confusion_review.evidence[0].url = "https://example.com/invalid";
  const good = load();
  documentGate(good, "counsel_confusion_review", "qualified_trademark_counsel");
  assert.equal(validateNameClearance(good), true);
  assert.throws(() => validateNameClearance(bad), /supporting document/u);
});
