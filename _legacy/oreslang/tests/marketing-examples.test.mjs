import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { languageMotionExamples as motion } from "../src/data/language-motion-examples.mjs";
import { highlight } from "../vendor/html-js-css-syntax-highlighter/src/index.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../src/pages/index.astro");
const detail = read("../src/pages/examples.astro");

test("home and examples import the same immutable code snippets", () => {
  for (const [page, text] of [["index", home], ["examples", detail]]) {
    assert.match(text, /import \{ languageMotionExamples as motion \} from "\.\.\/data\/language-motion-examples\.mjs"/);
    const imports = page === "index"
      ? /const \{ pipelineCode, mlCode, httpCode, selectCode \} = motion;/
      : /const \{ pipelineCode, mlCode, httpCode, httpStreamingCode, selectCode \} = motion;/;
    assert.match(text, imports);
    for (const name of ["pipelineCode", "mlCode", "httpCode", "selectCode"]) {
      assert.ok(text.includes("code={" + name + "}"), page + " missing " + name);
      assert.doesNotMatch(text, new RegExp("const " + name + " = `"));
    }
    assert.match(text, /not compiler-verified|not been compiler-verified/);
  }
  assert.ok(Object.isFrozen(motion));
});

test("three pipeline actors and exact typed pipe operator remain visible", () => {
  const code = motion.pipelineCode;
  for (const name of ["Source", "Transform", "Sink"]) {
    assert.match(code, new RegExp("define actor " + name + " as\\s*end"));
  }
  assert.equal((code.match(/define actor /g) || []).length, 3);
  assert.match(code, /pub fnc connect\(\): ActorStream<int>\s*\{/);
  assert.match(code, /return spawn Source\(\) pipe spawn Transform\(\) pipe spawn Sink\(\);/);
  assert.doesNotMatch(code, /\|>/);
  assert.match(home, /Empty actors show topology/);
});

test("ML example presents forward activations and reverse gradient flow without release claims", () => {
  const code = motion.mlCode;
  for (const token of ["define model Classifier as", "Dense(784, 512)", "Dense(512, 10)",
    "ml.pipeline(", "#one_forward_one_backward", "ml.trainer(", "CrossEntropy()",
    "AdamW(lr: 0.001)", "microbatches: 16", "Forward:", "Backward:",
    "self.backward(...)", "await trainer.train(dataset)"]) {
    assert.ok(code.includes(token), "missing ML example token " + token);
  }
  assert.match(code, /not a shipping compiler feature/);
  assert.doesNotMatch(code, /zero.copy|production.ready|verified backend/i);
});

test("HTTP design returns one Fetch-style response object with status and headers", () => {
  const code = motion.httpCode;
  assert.match(code, /define unary http actor HelloHttp as/);
  assert.match(code, /run\(HttpMessage request\): HttpResponse\s*\{/);
  assert.match(code, /return new HttpResponse\("hello from AttoLang", \{/);
  assert.match(code, /status: 200/);
  assert.match(code, /"Content-Type": "text\/plain; charset=utf-8"/);
  assert.doesNotMatch(code, /extends HttpActor|on_request\(|spawn HelloHttp\(|\.get_response\(|\.write\(|\.pipe\(/);
  assert.match(code, /VM-owned HTTP binding/);
  assert.match(code, /not yet compiler-verified/);
});

test("HTTP stream design transfers one body stream and explicitly declares trailers", () => {
  const code = motion.httpStreamingCode;
  assert.match(code, /run\(HttpMessage request\): HttpResponse/);
  assert.match(code, /const \(body, digestReady\) = checksumDownload\(\);/);
  assert.match(code, /return new HttpResponse\(body, \{/);
  assert.match(code, /trailerNames: \["Content-Digest"\]/);
  assert.match(code, /trailers: digestReady/);
  assert.match(code, /Future<HttpHeaders>/);
  assert.match(code, /backpressure/);
  assert.doesNotMatch(code, /\.pipe\(|\.stream\s*=|\.body\s*=|self\.end\(/);
  assert.match(detail, /code=\{httpStreamingCode\}/);
  assert.doesNotMatch(home, /code=\{httpStreamingCode\}/);
  assert.match(detail, /not part of the WHATWG/);
  assert.match(code, /not yet compiler-verified/);
});

test("select demo is a suspending statement, not a synchronous poll", () => {
  const code = motion.selectCode;
  assert.match(code, /\bdo select\s*\{/);
  assert.match(code, /when readch \w+: val \w+ \{/);
  assert.match(code, /when writech \w+, \w+: \{/);
  assert.doesNotMatch(code, /\bdo\s+nb\s+select\b|\btry\s+select\b|\bwhen\s+nb\s+readch\b/);
  assert.doesNotMatch(home + detail + code, /Poll once without waiting|nonblocking poll|repeated selection/);
  for (const form of ["select {}", "do select {}", "nb select {}"]) {
    assert.ok(detail.includes("<code>" + form + "</code>"), form);
  }
  assert.match(detail, /suspending result expression/);
  assert.match(detail, /suspending statement/);
  assert.match(detail, /asynchronous expression returning a Future/);
  assert.match(detail, /design target across backends/);
});

test("AttoLang code remains HTML escaped and highlighted", () => {
  const raw = "pub fnc connect(): ActorStream<int> { return spawn Source() pipe spawn Sink(); }";
  const html = highlight(raw, "oreslang");
  assert.ok(html.includes("&lt;"));
  assert.ok(html.includes("&gt;"));
  assert.match(html, /tok-keyword/);
  assert.ok(!html.includes("<int>"));
  const structural = highlight("match x over on structural {id: string} a -> {} end static fnc f(): void {}", "oreslang");
  for (const keyword of ["match", "over", "on", "structural", "static", "fnc", "end"]) {
    assert.ok(structural.includes(`<span class="tok-keyword">${keyword}</span>`), keyword);
  }
});
