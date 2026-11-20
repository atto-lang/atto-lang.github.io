import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const files = [
  ".github/workflows/validate-site.yml",
  ".github/workflows/deploy.yml",
  ".github/workflows/blog-quality.yml",
];
const manifest = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));

test("locked dependency graph includes the exact toolchain for blog CI", () => {
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  assert.ok(Object.keys(lock.packages).length > 450);
  for (const [name, version] of Object.entries({
    astro: "7.3.6",
    playwright: "1.56.1",
    lighthouse: "13.5.0",
  })) {
    assert.equal(lock.packages["node_modules/" + name].version, version);
  }
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (location && entry.resolved?.startsWith("https://registry.npmjs.org/")) {
      assert.match(entry.integrity ?? "", /^sha512-/u, location + " missing integrity");
    }
  }
});

for (const file of files) {
  test(file + " pins every GitHub Action by immutable SHA", () => {
    const yml = read(file);
    const actions = [...yml.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map((m) => m[1]);
    assert.ok(actions.length >= 2);
    for (const action of actions) {
      assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u, "Unpinned Action: " + action);
    }
    assert.doesNotMatch(yml, /\brun:\s*npm install\b/u);
    assert.match(yml, /\brun:\s*npm ci --no-fund/u);
    assert.match(yml, /persist-credentials: false/u);
  });
}

test("deployment uses least privilege; CI has read-only repository access", () => {
  const deploy = read(".github/workflows/deploy.yml");
  const validation = read(".github/workflows/validate-site.yml");
  assert.match(deploy, /permissions:\s*\n\s*contents: read/u);
  assert.match(deploy, /deploy:\s*\n\s*permissions:\s*\n\s*pages: write\s*\n\s*id-token: write/u);
  assert.match(validation, /permissions:\s*\n\s*contents: read/u);
  assert.match(validation, /test:blogs:browser/u);
  assert.match(validation, /test:lighthouse/u);
  assert.match(validation, /chromium firefox webkit/u);
  assert.match(deploy, /npm audit --omit=dev --audit-level=high/u);
  assert.match(deploy, /npm audit --audit-level=high/u);
  assert.match(validation, /npm audit --omit=dev --audit-level=high/u);
  assert.match(validation, /npm audit --audit-level=high/u);
  assert.ok(!existsSync(join(process.cwd(), ".github/workflows/lockfile-bootstrap.yml")), "Bootstrap must not be shipped");
});

test("submodule status guard rejects changed, uninitialized and conflict gitlinks", () => {
  for (const file of [".github/workflows/deploy.yml", ".github/workflows/validate-site.yml"]) {
    const yaml = read(file);
    const guard = "grep -Eq '^[+U-]' /tmp/oreslang-submodules.txt";
    assert.ok(yaml.includes(guard), file + " missing valid gitlink mismatch guard");
    assert.ok(!yaml.includes("^[+\\-U]"), file + " has malformed regex range");
    assert.match(yaml, /test -n "\$expected" && test "\$expected" = "\$actual"/u);
  }
  const statuses = ["+modified", "-uninitialized", "Uconflict", " unchanged"];
  const denied = statuses.filter(s => /^[+U-]/u.test(s));
  assert.deepEqual(denied, statuses.slice(0, 3));
});

test("pull-request site validation checks out and verifies the exact PR head, not a synthetic merge", () => {
  const validation = read(".github/workflows/validate-site.yml");
  assert.ok(validation.includes("ref: ${{ github.event.pull_request.head.sha }}"),
    "PR checkout must pin actual source head");
  assert.ok(validation.includes("EXPECTED_PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}"));
  assert.match(validation, /name: Verify exact PR head checkout/u);
  assert.match(validation, /test "\$actual" = "\$EXPECTED_PR_HEAD_SHA"/u);
});


test("required AttoLang PR check is uniquely named and never skipped by path filters", () => {
  const validate = read(".github/workflows/validate-site.yml");
  const deploy = read(".github/workflows/deploy.yml");
  const blog = read(".github/workflows/blog-quality.yml");
  assert.match(validate, /^name: Validate marketing site$/mu);
  assert.match(validate, /^on:\s*\n(?:[^\n]*\n)*?  pull_request:\s*$/mu);
  assert.match(validate, /^jobs:\s*\n  build:\s*\n    name: AttoLang Site Validation$/mu);
  assert.doesNotMatch(validate, /^\s+paths(?:-ignore)?:\s*$/mu,
    "required checks cannot skip config-only PRs");
  assert.doesNotMatch(validate, /^\s+branches(?:-ignore)?:\s*$/mu,
    "required checks cannot skip target branches");
  assert.doesNotMatch(deploy, /name: AttoLang Site Validation/u, "deployment must not reuse required check name");
  assert.doesNotMatch(blog, /name: AttoLang Site Validation/u, "manual jobs must not reuse required check name");
  assert.match(validate, /permissions:\s*\n\s*contents: read/u);
  assert.match(validate, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
});

test("required check cannot change to privileged pull_request_target or synthetic merge checkout", () => {
  const validation = read(".github/workflows/validate-site.yml");
  assert.doesNotMatch(validation, /^\s*pull_request_target:\s*$/mu);
  assert.equal((validation.match(/^\s*name: AttoLang Site Validation\s*$/gmu) ?? []).length, 1,
    "Required job name must appear exactly once");
  assert.match(validation, /^on:\s*\n(?:\s*#.*\n)*\s*pull_request:\s*$/mu);
  assert.match(validation, /EXPECTED_PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.doesNotMatch(validation, /\b(pull_request_target|workflow_run):\s*$/mu);
});
