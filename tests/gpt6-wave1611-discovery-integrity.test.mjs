import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const index = readFileSync(new URL("../public/llms.txt", import.meta.url), "utf8");
const canonical = [
  ["Java/GraalVM implementation", "oreslang-source.java",
    /not available to public crawlers or unauthenticated assistants/u],
  ["LLVM implementation", "oreslang-source.llvm",
    /not public evidence of native backend support/u],
  ["AttoLang formatter", "oreslang-format",
    /public syntax claims still require independent evidence/u],
];
const forbiddenPromotion =
  /\b(?:public repository|fully open source|fully supported|native guest parity proven|all backends verified|unrestricted source access)\b/iu;

// The release-discovery index is public prose, not a compiler/guest attestation.
function safelyDescribesPrivateSources(content) {
  // Publication can be compromised by a contradictory claim anywhere in the
  // index, even when all reviewed source rows remain byte-for-byte intact.
  if (forbiddenPromotion.test(content)) return false;
  if (!content.startsWith("# AttoLang\n") ||
      !content.includes("All backend support explicitly not-verified") ||
      !content.includes("Do not infer stable syntax or cross-backend parity")) return false;
  const lines = content.split("\n");
  for (const [label, repo, disclaimer] of canonical) {
    const matches = lines.filter(line => line.includes(label));
    if (matches.length !== 1) return false;
    const row = /^- \[([^\]]+)\]\(([^)]+)\): \*\*Private repository\*\*; ([^\n]+)$/u.exec(matches[0]);
    const expectedUrl = "https://github.com/ores-truffle-oreslang/" + repo;
    if (!row || row[1] !== label || row[2] !== expectedUrl ||
        !disclaimer.test(row[3]) || forbiddenPromotion.test(row[3])) return false;
  }
  return true;
}

test("public discovery pins private compiler/formatter identity and caveats", () => {
  assert.equal(safelyDescribesPrivateSources(index), true);
});

test("substituting private source URLs, labels or labels-as-URLs is rejected", () => {
  for (const [label, repo] of canonical) {
    const url = "https://github.com/ores-truffle-oreslang/" + repo;
    for (const replacement of [
      "https://attacker.invalid/" + repo,
      "http://github.com/ores-truffle-oreslang/" + repo,
      url + "-public",
      "https://github.com/other-org/" + repo,
    ]) {
      assert.equal(safelyDescribesPrivateSources(index.replace(url, replacement)), false,
        label + " " + replacement);
    }
    assert.equal(safelyDescribesPrivateSources(index.replace("[" + label + "]",
      "[" + label + " public]")), false, label + " relabeled");
  }
});

test("duplicated and mixed-status source disclosures fail closed", () => {
  for (const [label] of canonical) {
    const original = index.split("\n").find(line => line.includes(label));
    assert.ok(original);
    assert.equal(safelyDescribesPrivateSources(index + "\n" + original + "\n"), false,
      label + " duplicated private row");
    assert.equal(safelyDescribesPrivateSources(index + "\n- [" + label +
      "](https://attacker.invalid): **Public repository**; supported\n"), false,
      label + " shadow row");
    for (const claim of ["public repository", "all backends verified",
      "native guest parity proven", "unrestricted source access"]) {
      assert.equal(safelyDescribesPrivateSources(index.replace(original,
        original + "; " + claim)), false, label + " contradictory claim: " + claim);
    }
  }
});

test("removing any of the published evidence limitations is rejected", () => {
  for (const disclaimer of [
    "All backend support explicitly not-verified",
    "Do not infer stable syntax or cross-backend parity",
  ]) {
    assert.ok(index.includes(disclaimer));
    assert.equal(safelyDescribesPrivateSources(index.replace(disclaimer, "")), false);
  }
  for (const [label] of canonical) {
    const original = index.split("\n").find(line => line.includes(label));
    assert.equal(safelyDescribesPrivateSources(index.replace(original, "")), false,
      label + " missing");
  }
});

test("unrelated sections cannot smuggle public release or backend parity promotions", () => {
  for (const claim of [
    "All backends verified",
    "Native guest parity proven",
    "Fully open source",
    "UNRESTRICTED SOURCE ACCESS",
    "Public repository",
    "fully supported",
  ]) {
    const mutated = index + "\n## Release qualification\n" + claim + "\n";
    assert.equal(safelyDescribesPrivateSources(mutated), false,
      "appended contradictory release claim: " + claim);
  }
});

test("a positive caution cannot cancel a contradictory claim in the same paragraph", () => {
  const notice = "All backend support explicitly not-verified";
  const mutated = index.replace(notice, notice + "; ALL BACKENDS VERIFIED");
  assert.notEqual(mutated, index);
  assert.equal(safelyDescribesPrivateSources(mutated), false);
});
