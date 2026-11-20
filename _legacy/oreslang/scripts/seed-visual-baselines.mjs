import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { WIDTH, HEIGHT, normalizedPixels, makeBaseline } from "../tests/visual-signatures.mjs";

const root = resolve(process.argv[2] ?? "test-artifacts/screenshots");
const engines = ["chromium", "firefox", "webkit"];
const views = [375, 1440];
const routes = ["archive", "log-6", "log-7"];
const expected = engines.flatMap((engine) =>
  views.flatMap((width) => routes.map((route) =>
    engine + "-" + width + "-" + route + ".png")));
const filenames = (await readdir(root)).filter((name) => name.endsWith(".png")).sort();
assert.deepEqual(filenames, [...expected].sort(), "Seed run has missing or extra snapshots");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const images = {};
try {
  for (const filename of expected) {
    const screenshot = await readFile(join(root, filename));
    const expectedWidth = Number(filename.split("-")[1]);
    // Check the PNG header without trusting its filename alone.
    assert.equal(screenshot.toString("ascii", 1, 4), "PNG", filename);
    assert.equal(screenshot.readUInt32BE(16), expectedWidth, filename + " width mismatch");
    assert.equal(screenshot.readUInt32BE(20), 900, filename + " height mismatch");
    images[filename] = makeBaseline(screenshot, await normalizedPixels(page, screenshot));
  }
} finally {
  await page.close();
  await browser.close();
}
const manifest = {
  version: 1,
  description: "Reviewed real browser PNGs; normalized 32x24 RGB for bounded CI comparisons",
  source: {
    repository: "ores-truffle-oreslang/ores-truffle-oreslang.github.io",
    workflowRun: 38948068851,
    artifactId: 12067237575,
    gitCommit: "b4067c6a97258e6177fa397442c9607729020748",
  },
  environment: {
    node: "22.20.0",
    playwright: "1.56.1",
    snapshot: { width: WIDTH, height: HEIGHT, viewportHeight: 900 },
    artifact: "browser-visual-review",
  },
  images,
};
for (const line of (JSON.stringify(manifest, null, 2) + "\n").split("\n")) {
  console.log("VISUAL_BASELINE_LINE:" + line);
}
console.log("VISUAL_BASELINE_COMPLETE count=" + Object.keys(images).length);
