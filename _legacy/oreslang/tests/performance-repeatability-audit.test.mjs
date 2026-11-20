import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const previous = JSON.parse(read("../src/data/http-sweep-2026-10-12.json"));
const repeated = JSON.parse(read("../src/data/http-sweep-audit-2026-10-12.json"));
const excerpt = read("../public/performance/oreslang-http-sweep-audit-2026-10-12.txt");
const page = read("../src/pages/performance.astro");
const one = (section, regex, key) => {
  const matches = [...section.matchAll(regex)];
  assert.equal(matches.length, 1, key);
  return Number(matches[0][1]);
};

test("strict repeatability audit retains both independent raw rate mappings", () => {
  assert.equal(repeated.schema, "oreslang-http-offered-load-sweep.v2");
  assert.equal(repeated.source_mirror_tree, previous.source_mirror_tree_sha);
  assert.equal(repeated.wrk2_commit, previous.wrk2_commit_sha);
  assert.equal(repeated.adversarial_parser_tests_passed, 12);
  assert.equal(repeated.trials_per_rate, 1);
  assert.equal(repeated.negative_controls.length, 2);
  assert.deepEqual(repeated.measurements.map(r=>r.offered_rps), [500,1000,2000]);
  const sectionHeaders = [...excerpt.matchAll(/^R([0-9]+)\s*$/gm)];
  assert.deepEqual(sectionHeaders.map(m=>Number(m[1])),[500,1000,2000]);
  for(let i=0;i<sectionHeaders.length;i++) {
    const header=sectionHeaders[i];
    const rate=Number(header[1]);
    const end=i+1<sectionHeaders.length ? sectionHeaders[i+1].index : excerpt.indexOf("Limitations:",header.index);
    const text=excerpt.slice(header.index+header[0].length,end);
    const m=repeated.measurements[i];
    assert.equal(m.offered_rps,rate);
    assert.equal(one(text,/^\s*([0-9]+) requests in 1\.00m/gm,"completed requests"),m.completed_requests);
    assert.equal(one(text,/Total count\s*=\s*([0-9]+)/gm,"samples"),m.histogram_sample_count);
    assert.equal(one(text,/^Requests\/sec:\s*([0-9]+(?:\.[0-9]+)?)\s*$/gm,"achieved"),m.achieved_rps);
    for (const [key,p] of [["p50_ms","50.000"],["p99_ms","99.000"],["p999_ms","99.900"]]) {
      assert.equal(one(text,new RegExp("^\\s*"+p.replace(".","\\.")+"%\\s+([0-9]+(?:\\.[0-9]+)?)ms\\s*$","gm"),key),m[key]);
    }
    assert.ok(m.p50_ms<=m.p99_ms && m.p99_ms<=m.p999_ms);
    assert.equal(m.errors,0);
    assert.ok(m.histogram_sample_count<=m.completed_requests);
    assert.ok(m.achieved_rps<=m.offered_rps*1.10);
  }
  const run=repeated.run_url.match(/\/runs\/(\d+)$/);
  const artifact=repeated.artifact_url.match(/\/runs\/(\d+)\/artifacts\/(\d+)$/);
  assert.ok(run && artifact && run[1]===artifact[1]);
  assert.ok(repeated.limitations.includes("shared-runner"));
});

test("site compares original and repeat without silently overwriting either",()=>{
  assert.ok(page.includes("ci-plaintext-repeatability-audit"));
  assert.ok(page.includes('import httpSweepAudit from "../data/http-sweep-audit-2026-10-12.json"'));
  assert.ok(page.includes("substantial tail-latency variability in shared CI"));
  assert.equal(previous.measurements[1].p99_ms,2.58);
  assert.equal(repeated.measurements[1].p99_ms,11.11);
  assert.equal(previous.measurements[2].p99_ms,2.93);
  assert.equal(repeated.measurements[2].p99_ms,6.44);
});
