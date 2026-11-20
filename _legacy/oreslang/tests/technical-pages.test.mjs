import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const home = read("../src/pages/index.astro");
const nav = read("../src/components/SiteNav.astro");
const layout = read("../src/layouts/BaseLayout.astro");
const how = read("../src/pages/how-it-works.astro");
const perf = read("../src/pages/performance.astro");
const probe = JSON.parse(read("../src/data/http-plaintext-probe-2026-10-12.json"));
const wrk2 = JSON.parse(read("../src/data/http-wrk2-2026-10-12.json"));
const llvmPipeline = JSON.parse(read("../src/data/llvm-pipeline-launch-2026-10-12.json"));
const crossBackendMatrix = JSON.parse(read("../src/data/cross-backend-http-actor-matrix-2026-10-11.json"));
const applicationAreas = read("../src/pages/problem-spaces.astro");
const css = read("../src/styles/technical.css");

test("home copy names both compilation backends and fixes cooperative scheduling title", () => {
  const intro = home.indexOf("AttoLang was motivated by the need to create more stateful applications");
  const platforms = home.indexOf('class="hero-platforms"');
  const identity = home.indexOf('class="hero-tldr"');
  assert.ok(intro !== -1 && platforms > intro && identity > platforms);
  assert.ok(home.includes("Built for <strong>GraalVM</strong> and <strong>LLVM</strong>"));
  assert.ok(home.includes("<h3>Cooperative scheduling + scheduling un-cooperative code</h3>"));
  assert.ok(!home.includes("<h3>Scheduling code that will not yield</h3>"));
  assert.ok(css.includes(".hero-platforms strong { color: var(--orange)"));
});

test("both pages are reachable through shared desktop and mobile navigation", () => {
  for (const [label,href] of [["how it works", "/how-it-works/"],["performance", "/performance/"]]) {
    assert.ok(nav.includes('label: "' + label + '", href: "' + href + '"'));
  }
  assert.ok(nav.includes('{links.map((link) => <a href={link.href}>{link.label}</a>)}'));
  assert.ok(layout.includes('import "../styles/technical.css"'));
  assert.ok(how.includes('import BaseLayout from "../layouts/BaseLayout.astro"'));
  assert.ok(perf.includes('import BaseLayout from "../layouts/BaseLayout.astro"'));
});

test("OresVM technical explanation includes all requested scheduling and actor paths", () => {
  for (const term of ["OresVM", "AOT", "JIT", "hybrid", "<code>await</code>", "<code>select</code>",
    "<code>rt cooperate</code>", "for", "loop", "Shared", "Isolated / private", "Untrusted", "Hungry"]) {
    assert.ok(how.includes(term), "missing " + term);
  }
  assert.ok(how.includes("safepoint"));
  assert.ok(how.includes("not automatically"));
  assert.ok(how.includes("not yet general guest-code AOT lowering"));
  assert.ok(how.includes("not independent GC heaps") || how.includes("not independent GC heaps."));
  assert.ok(how.includes("experimental"));
  assert.ok(how.includes("Dedicated") || how.includes("dedicated"));
  assert.ok(how.includes("runtime/actor-physical-boundaries.md"));
});

test("performance page covers six auditable suites and never invents results", () => {
  assert.equal((perf.match(/number: "0[1-6]"/g) || []).length, 6);
  assert.equal((perf.match(/rows: \[/g) || []).length, 6);
  assert.equal((perf.match(/"No verified (?:AttoLang|OresVM) run"/g) || []).length, 17);
  for (const id of ["http-plaintext", "http-json", "http-routing", "http-database",
    "actor-mailbox", "scheduling-and-startup"]) {
    assert.ok(perf.includes('id: "' + id + '"'), "missing suite " + id);
  }
  assert.ok(perf.includes("wrk2"));
  assert.ok(perf.includes("TechEmpower"));
  assert.ok(perf.includes("source revisions, commands and raw outputs"));
  assert.ok(perf.includes("JVM/GraalVM HTTP measurements include three 60-second open-loop wrk2 trials"));
  assert.ok(perf.includes("not an official suite score"));
  assert.ok(perf.includes("httpProbe.trials.map"));
  assert.ok(perf.includes("httpWrk2.trials.map"));
  assert.ok(perf.includes("Measured CI at R"));
  assert.equal(wrk2.trials.length, 3);
  assert.equal(wrk2.duration_seconds_per_trial, 60);
  assert.equal(wrk2.connections, 128);
  assert.equal(wrk2.offered_requests_per_second, 300);
  assert.ok(wrk2.trials.every(t => t.errors === 0 && t.p50_ms > 0 && t.p99_ms > 0 && t.p999_ms > 0));
  const medianWrk2 = (name) => wrk2.trials.map(t => t[name]).sort((a,b) => a-b)[1];
  assert.equal(medianWrk2("achieved_rps"), wrk2.trial_median_achieved_rps);
  assert.equal(medianWrk2("p50_ms"), wrk2.trial_median_p50_ms);
  assert.equal(medianWrk2("p99_ms"), wrk2.trial_median_p99_ms);
  assert.equal(medianWrk2("p999_ms"), wrk2.trial_median_p999_ms);
  assert.match(wrk2.artifact_url, /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/\d+\/artifacts\/\d+$/);
  assert.ok(wrk2.limitations.includes("not saturation or maximum capacity"));
  assert.equal(probe.trials.length, 3);
  assert.ok(probe.trials.every((t) => t.requests === 600 && t.errors === 0));
  const median = (name) => probe.trials.map((t) => t[name]).sort((a,b) => a-b)[1];
  assert.equal(median("throughput_rps"), probe.median_throughput_rps);
  assert.equal(median("p50_ms"), probe.median_p50_ms);
  assert.equal(median("p95_ms"), probe.median_p95_ms);
  assert.equal(median("p99_ms"), probe.median_p99_ms);
  assert.match(probe.raw_evidence_artifact_url, /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/\d+\/artifacts\/\d+$/);
  assert.ok(perf.includes('class="tech-table"'));
  assert.ok(perf.includes('role="region" tabindex="0"'));
  assert.ok(css.includes("overflow-x: auto"));
  assert.ok(css.includes("@media (max-width: 580px)"));
});

test("Application Areas title is consistent on home, destination, and navigation", () => {
  assert.ok(home.includes('title="Application Areas" href="/problem-spaces/"'));
  assert.ok(applicationAreas.includes("<h1>Application Areas</h1>"));
  assert.ok(nav.includes('label: "application areas", href: hrefFor("problem-spaces")'));
  assert.ok(!home.includes('title="Where AttoLang is meant to matter"'));
});


test("LLVM guest pipeline measurement is real, source-pinned, and not misreported as throughput", () => {
  assert.ok(perf.includes('id="ci-llvm-pipeline-launch"'));
  assert.ok(perf.includes("llvmPipeline.results.map"));
  assert.ok(perf.includes("not</strong> pure mailbox latency or steady-state message throughput"));
  assert.equal(llvmPipeline.schema, "oreslang-llvm-guest-pipeline-process-summary-v1");
  assert.equal(llvmPipeline.trials_per_configuration, 3);
  assert.equal(llvmPipeline.validated_invocations_per_trial, 50);
  assert.deepEqual(llvmPipeline.results.map(r => r.actors), [2, 3, 4, 16]);
  assert.deepEqual(llvmPipeline.results.map(r => r.forward_hops), [1, 2, 3, 15]);
  assert.ok(llvmPipeline.results.every(r => r.forward_hops === r.backward_hops && r.validated === 150 && r.errors === 0));
  assert.ok(llvmPipeline.results.every(r => r.p99_us >= r.p95_us && r.p95_us >= r.median_us && r.median_us > 0));
  assert.match(llvmPipeline.run_url, /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/\d+$/);
  assert.match(llvmPipeline.raw_artifact_url, /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/\d+\/artifacts\/\d+$/);
  assert.ok(llvmPipeline.limitations.includes("not persistent-actor RTT"));
  assert.ok(perf.includes('"No verified OresVM run"'));
});

test("paired-source-kernel observations have explicit non-parity caveats and source-pinned funded receipts", () => {
  const m = crossBackendMatrix;
  assert.equal(m.schema, "oreslang-cross-backend-http-source-kernel-observations.v1");
  assert.equal(m.comparison_class.includes("NON_EQUIVALENT"), true);
  assert.equal(m.results.length, 16);
  assert.equal(m.test_contract.total_primary_measured_requests, 64000);
  assert.equal(m.test_contract.rounds, 4);
  assert.equal(m.test_contract.actors, 5);
  assert.equal(m.test_contract.measured_requests_per_scenario, 1000);
  assert.deepEqual(m.test_contract.concurrent_clients, [1,10,100,1000]);
  assert.match(m.guest_source_kernel_git_blob_sha, /^[0-9a-f]{40}$/);
  for (const b of ["llvm","graal"]) {
    assert.match(m[b].compiler_source_head_sha, /^[0-9a-f]{40}$/);
    assert.match(m[b].runner_commit_sha, /^[0-9a-f]{40}$/);
    assert.match(m[b].run_url, /^https:\/\/github\.com\/zed-pkg-test\/java-app\/actions\/runs\/\d+$/);
    assert.equal(m.results.filter(r => r.backend===b).length, 8);
  }
  for (const mode of ["shared","private"]) for(const backend of ["llvm","graal"]) {
    assert.deepEqual(m.results.filter(r => r.mode===mode && r.backend===backend).map(r => r.concurrency), [1,10,100,1000]);
  }
  for(const r of m.results) {
    assert.equal(r.rounds, 4);
    assert.equal(r.requests_per_round, 1000);
    assert.equal(r.total_errors, 0);
    assert.ok(r.median_rps>=r.min_rps && r.median_rps<=r.max_rps);
    assert.ok(r.median_p50_ms>0 && r.median_p50_ms<=r.median_p99_ms);
    assert.ok(Number.isInteger(r.total_gc_collections) && r.total_gc_collections>=0);
  }
  assert.ok(m.warnings.some(x=>x.includes("DIFFERENT")));
  assert.ok(m.warnings.some(x=>x.includes("self.forward()")));
  assert.ok(perf.includes('id="ci-cross-backend-kernel-matrix"'));
  assert.ok(perf.includes("separate shared GitHub-hosted runner executions"));
  assert.ok(perf.includes("not a controlled direct winner/loser comparison"));
  assert.ok(perf.includes("must not</strong> be compared"));
  assert.equal((perf.match(/"No verified (?:AttoLang|OresVM) run"/g)||[]).length, 17);
});

test("HTTP comparison explicitly limits OresVM integration claims", () => {
  assert.ok(perf.includes("<strong>OresVM subsystem coverage:</strong>"));
  assert.ok(perf.includes("partial-stack benchmark"));
  assert.ok(perf.includes("rather than exercising VM-owned ROOT and supervisor lifecycle"));
  assert.ok(perf.includes("source-level OresVM supervisor, ActorGroup or Mailman semantics"));
  assert.ok(perf.includes("No complete all-six-subsystems performance result has been published"));
});
