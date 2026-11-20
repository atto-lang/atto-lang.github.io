import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4322";
const outputDirectory = resolve("test-artifacts/lighthouse");
const routes = [
  { name: "home", path: "/" },
  { name: "archive", path: "/logs/" },
  { name: "actor-llm", path: "/logs/6/" },
];
const preview = spawn("python3", ["-m", "http.server", "4322", "--bind", "127.0.0.1", "--directory", "dist"], {
  stdio: "inherit",
});

function closePreview() {
  if (preview.exitCode === null) preview.kill("SIGTERM");
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (preview.exitCode !== null) throw new Error("Static server exited before Lighthouse");
    try {
      const response = await fetch(base + "/");
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("Static server did not start for Lighthouse");
}
async function runLighthouse(url, report) {
  const binary = resolve("node_modules/lighthouse/cli/index.js");
  const args = [
    binary, url,
    "--quiet",
    "--output=json",
    "--output-path=" + report,
    "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage",
    "--only-categories=performance,accessibility,best-practices,seo",
    "--max-wait-for-load=45000",
  ];
  const processEnv = { ...process.env, CHROME_PATH: chromium.executablePath() };
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { env: processEnv, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("close", (code) => code === 0 ? resolveRun() : rejectRun(
      new Error("Lighthouse exited " + code + " for " + url)
    ));
  });
}
await mkdir(outputDirectory, { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? "local",
  lighthouseVersion: "13.5.0",
  chromePath: chromium.executablePath(),
  results: [],
};
try {
  await ready();
  for (const route of routes) {
    const report = join(outputDirectory, route.name + ".json");
    await runLighthouse(base + route.path, report);
    const data = JSON.parse(await readFile(report, "utf8"));
    assert.equal(data.requestedUrl, base + route.path);
    const categories = {};
    for (const name of ["performance", "accessibility", "best-practices", "seo"]) {
      const score = data.categories?.[name]?.score;
      assert.ok(typeof score === "number" && Number.isFinite(score), route.name + " invalid " + name);
      categories[name] = Math.round(score * 100);
    }
    summary.results.push({ page: route.name, url: route.path, scores: categories });
    console.log("LIGHTHOUSE_BASELINE " + route.name + " " + JSON.stringify(categories));
  }
  await writeFile(join(outputDirectory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
} finally {
  closePreview();
}
