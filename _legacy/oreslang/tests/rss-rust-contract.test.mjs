import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
test("RSS validation uses Rust XML and RFC-2822 parsers instead of Python", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.match(scripts["test:rss:build"], /cargo test --locked --manifest-path tools\/rss-validator\/Cargo\.toml/u);
  assert.match(scripts["test:rss:build"], /cargo run --locked --bin attolang-rss-validator --manifest-path tools\/rss-validator\/Cargo\.toml/u);
  assert.match(scripts["test:rss:build"], /--bin svg-validator/u);
  assert.doesNotMatch(scripts["test:rss:build"], /python/u);
  assert.match(read("tools/rss-validator/Cargo.toml"), /roxmltree = "=0\.21\.1"/u);
  const code = read("tools/rss-validator/src/main.rs");
  for (const term of ["Document::parse","parse_from_rfc2822","HashSet","Missing sitemap URL"]) {
    assert.ok(code.includes(term), "Required validation: " + term);
  }
  const rustTests = read("tools/rss-validator/src/tests.rs");
  for (const testName of ["valid_feed","malformed_xml","invalid_escaping","bad_publication_date","wrong_author_namespace","missing_sitemap_entry"]) {
    assert.ok(rustTests.includes(testName), "Missing Rust regression case " + testName);
  }
});
test("push and PR workflows execute Rust validation with pinned toolchain", () => {
  for (const file of [".github/workflows/deploy.yml",".github/workflows/validate-site.yml"]) {
    const content=read(file);
    const rust=content.indexOf("dtolnay/rust-toolchain@686976e191b89faba57d3206551f0f330d8cb249");
    const test=content.indexOf("npm run test:rss:build");
    assert.ok(rust >= 0 && test > rust, "Rust setup before validator: " + file);
  }
  // The required status check must execute for every PR, including Rust-only
  // changes; an explicit tools/** filter leaves unrelated PRs unvalidated.
  const prWorkflow = read(".github/workflows/validate-site.yml");
  assert.match(prWorkflow, /^on:\s*\n(?:\s*#.*\n)*\s*pull_request:\s*$/mu);
  assert.doesNotMatch(prWorkflow, /^\s*(?:paths|paths-ignore|branches|branches-ignore):\s*$/mu);
  assert.match(prWorkflow, /name: AttoLang Site Validation/u);
});

test("Rust validator dependency graph is committed, checksummed and immutable", () => {
  const lock = read("tools/rss-validator/Cargo.lock");
  assert.match(lock, /^version = 4$/mu);
  for (const [name, version, checksum] of [
    ["chrono", "0.4.42", "145052bdd345b87320e369255277e3fb5152762ad123a901ef5c262dd38fe8d2"],
    ["roxmltree", "0.21.1", "f1964b10c76125c36f8afe190065a4bf9a87bf324842c05701330bba9f1cacbb"],
    ["num-traits", "0.2.19", "071dfc062690e90b734c0b2273ce72ad0ffa95f0c74596bc250dcfd960262841"],
    ["memchr", "2.8.3", "cf8baf1c55e62ffcace7a9f06f4bd9cd3f0c4beb022d3b367256b91b87513d98"],
    ["autocfg", "1.5.1", "f2032f911046de80f0a198e0901378627c33f59ea0ac00e363d481118bd70a53"],
  ]) {
    assert.ok(lock.includes('name = "' + name + '"'), "Missing locked crate " + name);
    assert.ok(lock.includes('version = "' + version + '"'), "Wrong locked version for " + name);
    assert.ok(lock.includes('checksum = "' + checksum + '"'), "Wrong lock checksum for " + name);
  }
  const script = JSON.parse(read("package.json")).scripts["test:rss:build"];
  assert.match(script, /git diff --exit-code -- tools\/rss-validator\/Cargo\.lock/u);
  assert.match(script, /cargo test --locked/u);
  assert.match(script, /cargo run --locked/u);
});

test("Rust CI consumes the committed lockfile without generating or uploading a replacement", () => {
  for (const workflow of [".github/workflows/deploy.yml", ".github/workflows/validate-site.yml"]) {
    const src = read(workflow);
    assert.match(src, /cargo metadata --locked --format-version 1 --manifest-path tools\/rss-validator\/Cargo\.toml/u);
    assert.match(src, /git diff --exit-code -- tools\/rss-validator\/Cargo\.lock/u);
    assert.doesNotMatch(src, /cargo generate-lockfile|rss-cargo-lockfile-bootstrap/u,
      "CI must not regenerate or publish a replacement dependency graph");
  }
});
