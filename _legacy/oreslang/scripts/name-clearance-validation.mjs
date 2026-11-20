import assert from "node:assert/strict";

const GATES = [
  "formal_us_search", "formal_international_search", "counsel_confusion_review",
  "native_linguist_review", "domain_registrar_review", "package_registry_review", "owner_signoff",
];
const CRITICAL = [
  "atto-language", "atto-actor-go", "atto-trademark-owner",
  "atto-us-reg-2680135", "atto-us-reg-2680136",
  "atto-us-reg-2680136-maintenance", "uspto-confusion", "uspto-clearance-method", "wipo-limits",
];
const PUBLIC_HOST = /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/iu;
const REVIEW_MAX_AGE_DAYS = 90;
const REQUIRED_US_RECORDS = [
  { serial: "76312586", registration: "2680135" },
  { serial: "76312590", registration: "2680136" },
];

function publicEvidenceURL(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password ||
        url.port || !PUBLIC_HOST.test(host) || !host.includes(".") ||
        host === "localhost" || /(?:^|\.)(?:localhost|local|internal|invalid|example|test)$/u.test(host) ||
        /(?:^|\.)example\.(?:com|org|net)$/u.test(host) ||
        /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host) || host.startsWith("xn--")) return null;
    const keys = [...url.searchParams.keys()].map(k => k.toLowerCase());
    if (keys.some(k => /(?:^|_)(?:token|secret|password|api_key|apikey|authorization|access_key)(?:$|_)/u.test(k)))
      return null;
    return url;
  } catch {
    return null;
  }
}

function verifiedDateWithin(value, auditDate, maxAge = REVIEW_MAX_AGE_DAYS) {
  if (!dateValid(value) || !dateValid(auditDate)) return false;
  const delta = (Date.parse(auditDate + "T00:00:00Z") - Date.parse(value + "T00:00:00Z")) / 86400000;
  return delta >= 0 && delta <= maxAge;
}

const DATE = /^\d{4}-\d\d-\d\d$/u;
const DECISIONS = ["cleared_in_scope", "risk_accepted_in_scope", "not_cleared"];
const REVIEWER_ROLES = {
  formal_us_search: ["qualified_trademark_counsel", "trademark_researcher"],
  formal_international_search: ["qualified_trademark_counsel", "trademark_researcher"],
  counsel_confusion_review: ["qualified_trademark_counsel"],
  native_linguist_review: ["linguistic_reviewer_lead"],
  domain_registrar_review: ["authorized_domain_reviewer"],
  package_registry_review: ["authorized_package_reviewer"],
  owner_signoff: ["authorized_owner"],
};

function dateValid(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function evidenceValid(item, auditDate) {
  return item && typeof item === "object" && publicEvidenceURL(item.url) !== null &&
    verifiedDateWithin(item.checked_on, auditDate) &&
    typeof item.summary === "string" && item.summary.trim().length >= 20;
}

function domainOrPackageValid(item, auditDate) {
  if (item === "unverified") return true;
  return item && typeof item === "object" &&
    ["available_checked", "occupied", "reserved_by_project"].includes(item.status) &&
    evidenceValid(item.evidence, auditDate) && typeof item.scope === "string" && item.scope.length >= 3;
}

function recordCheckValid(item, auditDate) {
  if (item?.verification_status !== "not_verified" &&
      item?.verification_status !== "verified_by_human") return false;
  const matched = REQUIRED_US_RECORDS.some(r => r.serial === item.serial_number &&
    r.registration === item.registration_number);
  if (!matched || !verifiedDateWithin(item.attempted_on, auditDate)) return false;
  const url = publicEvidenceURL(item.official_url);
  if (!url || url.hostname !== "tsdr.uspto.gov" ||
      new URLSearchParams(url.hash.slice(1)).get("caseNumber") !== item.serial_number) return false;
  if (item.verification_status === "not_verified") {
    return item.evidence === null && item.reviewer_id === null &&
      item.reported_status === null && typeof item.note === "string" && item.note.length > 25;
  }
  return evidenceValid(item.evidence, auditDate) &&
    publicEvidenceURL(item.evidence.url)?.hostname === "tsdr.uspto.gov" &&
    typeof item.reviewer_id === "string" && item.reviewer_id.trim().length >= 3 &&
    typeof item.reported_status === "string" && item.reported_status.trim().length >= 5;
}

export function validateNameClearance(data) {
  assert.equal(data.schema_version, 2, "schema version must match validator");
  assert.equal(data.candidate, "AttoLang");
  assert.ok(["provisional_not_cleared", "ready_for_owner_decision"].includes(data.status),
    "A CI-validated data file cannot certify a globally cleared trademark");
  assert.ok(dateValid(data.as_of), "valid audit date required");
  assert.ok(Date.parse(data.as_of + "T00:00:00Z") <= Date.now(),
    "audit date cannot be in the future");
  if (data.status === "ready_for_owner_decision") {
    assert.ok(verifiedDateWithin(data.as_of, new Date().toISOString().slice(0, 10), 30),
      "owner decision cannot use an audit older than 30 days");
  }

  const findings = data.verified_public_findings;
  assert.ok(Array.isArray(findings) && findings.length >= CRITICAL.length);
  assert.equal(new Set(findings.map(f => f.id)).size, findings.length, "duplicate public evidence ID");
  for (const id of CRITICAL) assert.ok(findings.some(f => f.id === id), "missing documented collision/source: " + id);
  for (const source of findings) {
    assert.match(source.id, /^[a-z0-9-]+$/u);
    assert.ok(["dictionary", "software", "owner_statement", "third_party_registry", "regulator_guidance"].includes(source.kind));
    assert.ok(publicEvidenceURL(source.url), "public evidence must have a safe HTTPS source");
    assert.ok(typeof source.finding === "string" && source.finding.trim().length >= 25);
  }

  const checks = data.official_us_record_checks;
  assert.ok(Array.isArray(checks) && checks.length === REQUIRED_US_RECORDS.length,
    "exact official US record check inventory required");
  assert.deepEqual(checks.map(x => x.serial_number).sort(),
    REQUIRED_US_RECORDS.map(x => x.serial).sort(), "missing or duplicated official registration record");
  for (const check of checks) assert.ok(recordCheckValid(check, data.as_of),
    "registration status cannot be promoted without official case evidence");

  assert.ok(Array.isArray(data.languages) && data.languages.length >= 30, "30+ target languages required");
  assert.equal(new Set(data.languages.map(x => x.code)).size, data.languages.length, "duplicate language");
  for (const l of data.languages) {
    assert.match(l.code, /^[a-z]{2}$/u);
    assert.ok(typeof l.name === "string" && l.name.length > 1);
    if (l.native_speaker_review === "pending") continue;
    assert.equal(l.native_speaker_review, "documented");
    assert.ok(evidenceValid(l.evidence, data.as_of), "independent native-speaker evidence required for " + l.code);
    assert.ok(typeof l.reviewer_id === "string" && l.reviewer_id.trim().length >= 3);
  }

  assert.equal(data.software_identity.atto_already_used, true);
  assert.equal(data.software_identity.attolang_exact_name_uniqueness, "unverified",
    "public-source search cannot establish uniqueness");
  assert.equal(data.software_identity.github_attolang_org_control, "unverified",
    "ownership requires a separate authenticated check");
  for (const key of ["attolang.com", "attolang.org", "attolang.dev"]) {
    assert.ok(domainOrPackageValid(data.identifiers.domains[key], data.as_of), "invalid domain record " + key);
  }
  for (const key of ["npm", "pypi", "crates", "nuget"]) {
    assert.ok(domainOrPackageValid(data.identifiers.packages[key], data.as_of), "invalid registry record " + key);
  }

  assert.deepEqual(Object.keys(data.decision_gates).sort(), [...GATES].sort(),
    "gate set cannot be removed or silently expanded");
  const documented = new Set();
  for (const [key, value] of Object.entries(data.decision_gates)) {
    assert.ok(value && typeof value === "object", "gate must have evidence-aware status");
    assert.ok(["pending", "documented"].includes(value.status), "invalid gate status " + key);
    if (value.status === "pending") {
      assert.deepEqual(value.evidence, [], "pending gate cannot carry unreviewed evidence");
      for (const field of ["reviewed_at", "reviewer_role", "reviewer_id", "scope", "conclusion"])
        assert.equal(value[field], null, "pending gate cannot imply approval: " + key + "." + field);
      continue;
    }
    documented.add(key);
    assert.ok(Array.isArray(value.evidence) && value.evidence.length > 0, "no approval without evidence: " + key);
    for (const item of value.evidence) assert.ok(evidenceValid(item, data.as_of), "invalid supporting document for " + key);
    assert.ok(verifiedDateWithin(value.reviewed_at, data.as_of), "review date missing, stale or after audit date: " + key);
    assert.ok(REVIEWER_ROLES[key].includes(value.reviewer_role), "wrong review role for " + key);
    assert.ok(typeof value.reviewer_id === "string" && value.reviewer_id.trim().length >= 3, "reviewer missing for " + key);
    assert.ok(typeof value.scope === "string" && value.scope.trim().length >= 5, "scope missing for " + key);
    assert.ok(DECISIONS.includes(value.conclusion), "conclusion missing for " + key);
  }
  if (documented.has("formal_us_search")) {
    assert.ok(checks.every(x => x.verification_status === "verified_by_human"),
      "US trademark gate requires human-reviewed official registration records");
  }
  if (documented.has("native_linguist_review")) {
    assert.ok(data.languages.every(l => l.native_speaker_review === "documented"),
      "language review gate requires each target language's evidence");
  }
  if (documented.has("domain_registrar_review")) {
    assert.ok(Object.values(data.identifiers.domains).every(x => x !== "unverified"),
      "domain gate requires all domains checked");
  }
  if (documented.has("package_registry_review")) {
    assert.ok(Object.values(data.identifiers.packages).every(x => x !== "unverified"),
      "package gate requires all registries checked");
  }
  if (documented.has("owner_signoff")) {
    assert.ok(GATES.filter(x => x !== "owner_signoff").every(x => documented.has(x)),
      "owner signoff cannot precede completed evidence/review gates");
    assert.notEqual(data.decision_gates.owner_signoff.reviewer_id,
      data.decision_gates.counsel_confusion_review.reviewer_id,
      "owner and counsel must be independently identified");
    assert.ok(data.decision_gates.owner_signoff.conclusion !== "cleared_in_scope" ||
      GATES.every(x => data.decision_gates[x].conclusion === "cleared_in_scope"),
      "owner cannot claim clearance where any gate found risk");
  }
  if (data.status === "ready_for_owner_decision") {
    assert.ok(GATES.filter(x => x !== "owner_signoff").every(x => documented.has(x)),
      "readiness must be supported by independent reviews");
    assert.ok(GATES.filter(x => x !== "owner_signoff").every(x =>
      data.decision_gates[x].conclusion !== "not_cleared"),
      "an explicit not-cleared conclusion blocks readiness");
    assert.ok(!documented.has("owner_signoff"), "owner-signoff workflow happens after readiness");
  }
  assert.ok(typeof data.legal_note === "string" && /cannot authenticate legal/i.test(data.legal_note),
    "legal-limit disclaimer required");
  return true;
}
