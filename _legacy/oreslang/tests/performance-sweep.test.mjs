import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const receipt = JSON.parse(read("../src/data/http-sweep-2026-10-12.json"));
const baseline = JSON.parse(read("../src/data/http-wrk2-2026-10-12.json"));
const excerpt = read("../public/performance/oreslang-http-sweep-2026-10-12.txt");
const page = read("../src/pages/performance.astro");
const contract = JSON.parse(read("../src/data/schemas/oreslang-http-sweep-v1.schema.json"));

const exactlyOne = (text, pattern, description) => {
  const found = [...text.matchAll(pattern)];
  assert.equal(found.length, 1, "one " + description + " required");
  return found[0];
};
const finitePositive = (n, label) =>
  assert.ok(typeof n === "number" && Number.isFinite(n) && n > 0, label + " must be finite, positive");
const approximately = (observed, expected, tolerance, label) => {
  finitePositive(observed, label);
  assert.ok(Math.abs(observed - expected) <= tolerance, label + " does not agree with raw evidence");
};

function parseExcerpt(source) {
  const sections = [...source.matchAll(/^R([0-9]+)\s*$/gm)];
  assert.deepEqual(sections.map(s => Number(s[1])), [500, 1000, 2000],
    "one and only one ordered raw block must exist for every offered rate");
  const outputs = new Map();
  sections.forEach((item, i) => {
    const start = item.index + item[0].length;
    const end = i + 1 < sections.length ? sections[i+1].index : source.indexOf("Limitations:", start);
    assert.ok(end > start, "rate block must have a terminator");
    const block = source.slice(start, end);
    for (const prohibited of ["Socket errors:", "Non-2xx or 3xx responses:", "INVALID_HTTP_RESPONSE", "-nan", "NaN"]) {
      assert.ok(!block.includes(prohibited), "no successful evidence row can have " + prohibited);
    }
    const count = Number(exactlyOne(block, /^\s*([0-9]+) requests in 1\.00m,/gm, "request count")[1]);
    const hist = Number(exactlyOne(block, /Total count\s*=\s*([0-9]+)\]/gm, "histogram count")[1]);
    const throughput = Number(exactlyOne(block, /^Requests\/sec:\s*([0-9]+(?:\.[0-9]+)?)\s*$/gm, "throughput")[1]);
    const latency = (percentile) => {
      const match = exactlyOne(block,
        new RegExp("^\\s*" + percentile.replace(".", "\\.") + "%\\s+([0-9]+(?:\\.[0-9]+)?)(us|ms|s)\\s*$", "gm"),
        "latency " + percentile
      );
      const factor = {us: 0.001, ms: 1, s: 1000}[match[2]];
      return Number(match[1]) * factor;
    };
    outputs.set(Number(item[1]), {
      count, hist, throughput,
      p50_ms: latency("50.000"), p99_ms: latency("99.000"), p999_ms: latency("99.900")
    });
  });
  return outputs;
}

function verify(s, source=excerpt) {
  assert.equal(s.schema, "oreslang-http-offered-load-sweep.v1");
  assert.equal(s.execution_profile, "jvm-jit");
  assert.equal(s.body_bytes, 64);
  assert.equal(s.source_blob_count_verified, 403);
  assert.equal(s.source_mirror_tree_sha, baseline.source_mirror_tree_sha);
  assert.equal(s.wrk2_commit_sha, baseline.wrk2_upstream_commit_sha);
  for (const name of ["runner_commit_sha", "source_mirror_commit_sha", "source_mirror_tree_sha", "wrk2_commit_sha"])
    assert.match(s[name], /^[0-9a-f]{40}$/);
  assert.equal(s.runner_repository_visibility, "private");
  assert.equal(s.independent_jvm_per_rate, true);
  assert.equal(s.strict_wrong_body_negative_control_passed, true);
  assert.equal(s.connections, 128);
  assert.equal(s.threads, 4);
  assert.equal(s.duration_seconds_per_rate, 60);
  const names = s.measurements.map(m => m.offered_rps);
  assert.deepEqual(names, [500,1000,2000]);
  const run = s.run_url.match(/^https:\/\/github\.com\/zed-pkg-test\/formal-methods-cross-check\/actions\/runs\/(\d+)$/);
  const artifact = s.artifact_url.match(/^https:\/\/github\.com\/zed-pkg-test\/formal-methods-cross-check\/actions\/runs\/(\d+)\/artifacts\/(\d+)$/);
  assert.ok(run && artifact, "CI URLs must point to the intended private runner");
  assert.equal(run[1], artifact[1], "artifact must belong to the same verified CI run");
  assert.equal(s.public_excerpt_url, "/performance/oreslang-http-sweep-2026-10-12.txt");
  assert.match(s.limitations, /did not find saturation/);
  assert.match(s.limitations, /one machine/);

  const raw = parseExcerpt(source);
  for (const m of s.measurements) {
    const x = raw.get(m.offered_rps);
    assert.ok(x, "unmatched raw section");
    assert.ok(Number.isInteger(m.completed_requests) && m.completed_requests > 100);
    assert.ok(Number.isInteger(m.histogram_sample_count) && m.histogram_sample_count > 100);
    assert.ok(m.histogram_sample_count <= m.completed_requests);
    finitePositive(m.achieved_rps, "achieved rate");
    assert.ok(m.achieved_rps <= m.offered_rps * 1.10);
    for (const name of ["p50_ms", "p99_ms", "p999_ms"]) finitePositive(m[name], name);
    assert.ok(m.p50_ms <= m.p99_ms && m.p99_ms <= m.p999_ms);
    assert.equal(m.errors, 0);
    assert.equal(m.completed_requests, x.count, "wrong request count in rate block");
    assert.equal(m.histogram_sample_count, x.hist, "wrong histogram count in rate block");
    approximately(m.achieved_rps, x.throughput, 0.01, "raw throughput");
    for (const key of ["p50_ms", "p99_ms", "p999_ms"])
      approximately(m[key], x[key], 0.0006, "raw " + key);
    assert.ok(Math.abs(m.completed_requests / s.duration_seconds_per_rate - m.achieved_rps) < 1);
  }
}

test("receipt is independently matched to each corresponding raw rate block", () => verify(receipt));

test("wrong rate, swapped data, fabricated latency and bad artifacts all fail closed", () => {
  let bad = structuredClone(receipt);
  [bad.measurements[0].p99_ms, bad.measurements[2].p99_ms] =
    [bad.measurements[2].p99_ms, bad.measurements[0].p99_ms];
  assert.throws(() => verify(bad));
  bad = structuredClone(receipt);
  bad.measurements[1].achieved_rps = 2000;
  assert.throws(() => verify(bad));
  bad = structuredClone(receipt);
  bad.measurements[0].histogram_sample_count = 199;
  assert.throws(() => verify(bad));
  bad = structuredClone(receipt);
  bad.artifact_url = bad.artifact_url.replace("38199979586", "111111");
  assert.throws(() => verify(bad));
  bad = structuredClone(receipt);
  bad.measurements[0].p99_ms = Infinity;
  assert.throws(() => verify(bad));
  const duplicate = excerpt.replace("R1000\n", "R500\n");
  assert.throws(() => verify(receipt, duplicate));
  const corrupted = excerpt.replace("Requests/sec:    500.50", "Requests/sec:    900.00");
  assert.throws(() => verify(receipt, corrupted));
});

test("reviewable JSON Schema contract forbids unknown fields and invalid metric shapes", () => {
  assert.equal(contract.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(contract.additionalProperties, false);
  assert.equal(contract.properties.measurements.minItems, 3);
  assert.equal(contract.properties.measurements.maxItems, 3);
  assert.equal(contract.properties.measurements.items.additionalProperties, false);
  for (const field of ["schema", "measurements", "runner_commit_sha", "wrk2_commit_sha", "run_url"])
    assert.ok(contract.required.includes(field), "schema must require " + field);
});

test("published page clearly separates single-run sweep from saturation claims", () => {
  assert.ok(page.includes('import httpSweep from "../data/http-sweep-2026-10-12.json"'));
  assert.ok(page.includes('id="ci-plaintext-private-rate-sweep"'));
  assert.ok(page.includes("The saturation point has not been measured"));
  assert.ok(page.includes("access required"));
});
