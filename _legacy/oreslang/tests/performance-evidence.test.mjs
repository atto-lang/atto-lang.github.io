import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (name) => JSON.parse(readFileSync(new URL("../src/data/" + name, import.meta.url), "utf8"));
const wrk2 = load("http-wrk2-2026-10-12.json");
const probe = load("http-plaintext-probe-2026-10-12.json");
const gitSha = /^[0-9a-f]{40}$/;
const githubRun = /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/([0-9]+)$/;
const githubArtifact = /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/([0-9]+)\/artifacts\/([0-9]+)$/;
const finitePositive = (n, label) => {
  assert.equal(typeof n, "number", label + ": expected numeric observation");
  assert.ok(Number.isFinite(n) && n > 0, label + ": expected finite positive value");
};
const median = (values) => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const evidenceUrls = (run, artifact, label) => {
  const runMatch = githubRun.exec(run);
  const artifactMatch = githubArtifact.exec(artifact);
  assert.ok(runMatch && artifactMatch, label + ": must link to exact runner and run artifact");
  assert.equal(runMatch[1], artifactMatch[1], label + ": artifact must come from observed run");
};

function verifyWrk2(data) {
  assert.equal(data.schema,"oreslang-wrk2-http.v1");
  assert.equal(data.execution_profile,"jvm-jit");
  assert.equal(data.body_bytes,64);
  assert.equal(data.target.includes("loopback"),true);
  assert.equal(data.offered_requests_per_second,300);
  assert.equal(data.duration_seconds_per_trial,60);
  assert.equal(data.connections,128);
  assert.equal(data.load_generator_threads,4);
  assert.match(data.source_mirror_tree_sha,gitSha);
  assert.match(data.test_branch_commit_sha,gitSha);
  assert.match(data.wrk2_upstream_commit_sha,gitSha);
  evidenceUrls(data.run_url,data.artifact_url,"wrk2");
  assert.ok(data.harness_url.includes(data.test_branch_commit_sha) ||
    data.harness_url.includes("ci/oreslang-performance-wrk2-20261011"),
    "harness URL must point to the named source revision or named benchmark branch");
  assert.equal(data.trials.length,3);
  assert.ok(data.trials.every((t,i)=>t.trial===i+1),"trial identities must be unique and sequential");
  for(const t of data.trials){
    assert.ok(Number.isInteger(t.errors) && t.errors>=0);
    finitePositive(t.achieved_rps,"achieved rate");
    assert.ok(t.achieved_rps<=data.offered_requests_per_second*1.10,"achieved load inconsistent with offered rate");
    for(const k of ["p50_ms","p99_ms","p999_ms"]) finitePositive(t[k],k);
    assert.ok(t.p50_ms<=t.p99_ms && t.p99_ms<=t.p999_ms,"latency quantiles must be monotonic");
  }
  assert.equal(data.total_errors,data.trials.reduce((sum,t)=>sum+t.errors,0),"total errors must agree with trials");
  for(const [field,metric] of [
    ["trial_median_achieved_rps","achieved_rps"],
    ["trial_median_p50_ms","p50_ms"],
    ["trial_median_p99_ms","p99_ms"],
    ["trial_median_p999_ms","p999_ms"]]){
    assert.equal(data[field],median(data.trials.map(t=>t[metric])),field+" must be recalculated from observed trials");
  }
  assert.ok(Number.isInteger(data.histogram_sample_count_per_trial) &&
    data.histogram_sample_count_per_trial>100,"histograms require recorded samples");
  assert.match(data.limitations,/not saturation or maximum capacity/);
  assert.match(data.limitations,/shared GitHub-hosted runner/);
  assert.match(data.response_validation,/No deliberately wrong-response negative control/);
  assert.ok(!data.limitations.includes("official TechEmpower score"),"claim must be non-official");
}

function verifyProbe(data) {
  assert.equal(data.schema,"oreslang-performance-probe.v1");
  assert.equal(data.execution_mode,"jvm-jit");
  assert.match(data.source_mirror_tree_sha,gitSha);
  assert.match(data.test_commit_sha,gitSha);
  evidenceUrls(data.run_url,data.raw_evidence_artifact_url,"exploratory");
  assert.equal(data.run_id,Number(githubRun.exec(data.run_url)[1]));
  assert.equal(data.trials.length,3);
  for(const [index,t] of data.trials.entries()){
    assert.equal(t.trial,index+1);
    assert.equal(t.requests,600);
    assert.ok(Number.isInteger(t.errors) && t.errors>=0);
    for(const k of ["duration_seconds","throughput_rps","p50_ms","p95_ms","p99_ms"])
      finitePositive(t[k],"exploratory "+k);
    assert.ok(t.p50_ms<=t.p95_ms && t.p95_ms<=t.p99_ms,
      "exploratory latency quantiles must be monotonic");
    assert.ok(Math.abs(t.throughput_rps*t.duration_seconds-t.requests)<0.15,
      "exploratory throughput, elapsed time, and completed requests must agree");
  }
  for(const [field,metric] of [
    ["median_throughput_rps","throughput_rps"],
    ["median_p50_ms","p50_ms"],
    ["median_p95_ms","p95_ms"],
    ["median_p99_ms","p99_ms"]])
    assert.equal(data[field],median(data.trials.map(t=>t[metric])));
  assert.match(data.limitations,/not an official TechEmpower/);
}

test("all published wrk2 evidence is internally consistent and traceable",()=>verifyWrk2(wrk2));
test("exploratory probe measurements agree with completed requests and wall time",()=>verifyProbe(probe));
test("tampered medians, false latency ordering, and missing provenance are rejected",()=>{
  const copy=()=>structuredClone(wrk2);
  let altered=copy();
  altered.trial_median_p99_ms=0.01;
  assert.throws(()=>verifyWrk2(altered));
  altered=copy();
  altered.trials[1].p99_ms=0.000001;
  assert.throws(()=>verifyWrk2(altered));
  altered=copy();
  altered.artifact_url="https://github.com/zed-pkg-test/java-app/actions/runs/999/artifacts/11724960405";
  assert.throws(()=>verifyWrk2(altered));
  altered=copy();
  altered.wrk2_upstream_commit_sha="floating-main";
  assert.throws(()=>verifyWrk2(altered));
  altered=copy();
  altered.total_errors=1;
  assert.throws(()=>verifyWrk2(altered));
});
