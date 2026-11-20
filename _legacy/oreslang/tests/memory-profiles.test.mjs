import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const home = read("../src/pages/index.astro");
const philosophy = read("../src/pages/philosophy.astro");
const architecture = read("../src/pages/how-it-works.astro");
const profiles = read("../src/components/MemoryProfiles.astro");
const css = read("../src/styles/technical.css");

test("both memory profiles are explicit and do not promise shipping zero-GC", () => {
  for (const phrase of ["Zero GC", "Minimal GC", "LLVM", "JVM / GraalVM", "Ownership and borrowing",
    "native arenas", "FFM", "not guarantee zero pauses", "Zero GC does not mean zero allocation"]) {
    assert.ok(profiles.includes(phrase), "missing " + phrase);
  }
  assert.match(profiles, /proposed|target/i);
  assert.match(architecture, /not a declaration that full LLVM no-GC compilation is shipping/);
  assert.match(architecture, /experimental/);
});

test("homepage, philosophy and OresVM architecture share the same static memory model", () => {
  for (const [source, route] of [[home, "home"], [philosophy, "philosophy"], [architecture, "how-it-works"]]) {
    assert.match(source, /import MemoryProfiles from "\.\.\/components\/MemoryProfiles\.astro"/, route);
    assert.match(source, /<MemoryProfiles\s*\/>/, route);
    assert.match(source, /id="memory-management"/, route);
  }
  assert.match(home, /Actor-owned arenas on both backends/);
  assert.match(home, /href="\/how-it-works\/#memory-management"/);
});

test("strict no-GC model fails closed and does not conflate Epsilon GC with memory reclamation", () => {
  for (const phrase of ["Fail closed", "Cycles and async", "actor turn/request", "p99/p999",
    "Zero GC is not zero allocation", "--gc=epsilon", "no reclamation", "LLVM GC integration model"]) {
    assert.ok(architecture.includes(phrase), "missing " + phrase);
  }
  assert.match(architecture, /do not silently introduce tracing GC/);
  assert.match(architecture, /not a substitute for deterministic reclamation/);
});

test("separate per-actor arenas are not misrepresented as independent JVM GC heaps", () => {
  for (const x of ["Actor-owned arenas and GC boundaries", "In the current JVM bootstrap",
    "do not create independent", "Pooled untrusted Graal isolate",
    "One Graal isolate per untrusted actor (optional)", "shared by those guest actors",
    "greater memory/startup/scheduling cost"]) {
    assert.ok(architecture.includes(x), "missing architecture distinction " + x);
  }
  assert.ok(profiles.includes("not separate JVM GC heaps"));
  assert.ok(profiles.includes("FFM"));
  assert.ok(philosophy.includes("does not automatically establish"));
});

test("memory cards work at narrow widths and use semantic theme tokens", () => {
  assert.match(css, /\.memory-profile-grid\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 750px\)\s*\{\s*\.memory-profile-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.memory-profile\s*\{[^}]*var\(--surface\)/);
  assert.match(profiles, /<article class="memory-profile/);
});
