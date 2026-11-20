import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");
const inventory = JSON.parse(read("src/data/engineering-log-examples.json"));
const entries = inventory.examples;

test("every rendered or highlighted blog sample is accounted for in an evidence inventory", () => {
  assert.equal(inventory.schemaVersion, 2);
  assert.equal(entries.length, 20);
  assert.equal(new Set(entries.map((x) => x.id)).size, entries.length);
  for (let log = 1; log <= 10; log++) {
    const matching = entries.filter((x) => x.log === log);
    const source = log <= 5
      ? "src/components/Log" + log + "Content.astro"
      : "src/pages/logs/" + log + ".astro";
    const fragments = [...read(source).matchAll(/<(?:pre|OresCode)\b/gu)];
    assert.equal(matching.length, fragments.length, "Log " + log + " has unreviewed examples");
    assert.deepEqual(matching.map((x) => x.ordinal), fragments.map((_, index) => index + 1));
    for (const entry of matching) {
      assert.equal(entry.source, source);
      assert.ok(entry.kind && entry.note.length >= 20);
      assert.ok(["illustrative", "experimental", "verified"].includes(entry.status));
      assert.equal(typeof entry.compilerVerified, "boolean");
      assert.ok(["proposed-source", "source-requires-imports", "intentionally-invalid-source",
        "style-illustration", "candidate-source", "non-compiler-artifact"]
        .includes(entry.validationClass));
      assert.ok(Array.isArray(entry.verifiedBackends));
      if (entry.validationClass === "non-compiler-artifact" ||
          entry.validationClass === "intentionally-invalid-source") {
        assert.equal(entry.compilerVerified, false, "Non-executable/invalid snippet cannot be certified");
      }
      if (entry.status === "verified" || entry.compilerVerified) {
        assert.equal(entry.status, "verified");
        assert.ok(/^[0-9a-f]{40}$/u.test(entry.compilerCommit ?? ""), "No pinned compiler commit");
        assert.ok(/^https:\/\/github\.com\//u.test(entry.verificationRun ?? ""), "No CI evidence URL");
      } else {
        assert.equal(entry.compilerVerified, false);
        assert.equal(entry.compilerCommit, null);
        assert.equal(entry.verificationRun, null);
      }
    }
  }
});

test("production blog prose must not imply unchecked examples were compiler-verified", () => {
  const source = read("src/components/Log4Content.astro");
  assert.doesNotMatch(source, /formatter-verified AttoLang/u);
  const llvm = read("src/components/Log1Content.astro");
  assert.match(llvm, /proposed syntax, not implemented AttoLang/u);
  const actor = read("src/pages/logs/6.astro");
  assert.match(actor, /They do not calculate derivatives/u);
});

test("compiler candidate's published bytes match the private test's SHA-256 fixture", () => {
  const entry = entries.find((item) => item.id === "log-007-sample-02");
  assert.equal(entry.validationClass, "candidate-source");
  assert.equal(entry.compilerVerified, false, "Compiler run has not been established yet");
  assert.deepEqual(entry.verifiedBackends, []);
  const html = read(entry.source);
  const raw = html.match(/<pre tabindex="0"><code>(pub fnc calculate[\s\S]*?)<\/code><\/pre>/u)?.[1];
  assert.ok(raw, "Log 007 function snippet missing");
  const decoded = raw.replaceAll("&#123;", "{").replaceAll("&#125;", "}")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const digest = createHash("sha256").update(decoded, "utf8").digest("hex");
  assert.equal(digest, entry.publishedSourceSha256,
    "Published snippet drifted from pinned compiler evidence candidate");
});
