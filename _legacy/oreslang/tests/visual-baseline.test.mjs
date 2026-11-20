import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { BYTE_COUNT, compareVisual, checkScreenshotPng } from "./visual-signatures.mjs";

const inventory = JSON.parse(readFileSync(new URL("./visual-baselines.json", import.meta.url), "utf8"));

test("visual baselines have exact-source provenance, including approved per-image refreshes", () => {
  assert.equal(inventory.version, 1);
  assert.equal(inventory.source.repository, "ores-truffle-oreslang/ores-truffle-oreslang.github.io");
  assert.equal(inventory.source.workflowRun, 38948068851);
  assert.equal(inventory.source.artifactId, 12067237575);
  assert.match(inventory.source.gitCommit, /^[0-9a-f]{40}$/u);
  assert.deepEqual(inventory.environment.snapshot, { width: 32, height: 24, viewportHeight: 900 });
  assert.equal(inventory.environment.playwright, "1.56.1");
  // Original seed remains intact for unaffected captures. Existing wordmark
  // review metadata applies to log-7; archive captures now have their own
  // reviewed source/artifact provenance after publication of log 010.
  const archiveKeys = ["chromium", "firefox", "webkit"].flatMap((engine) =>
    [375, 1440].map((width) => engine + "-" + width + "-archive.png")
  );
  const wordmarkKeys = ["chromium-375-log-7.png", "firefox-375-log-7.png", "webkit-375-log-7.png"];
  assert.deepEqual(Object.keys(inventory.reviewedOverrides).sort(),
    [...archiveKeys, ...wordmarkKeys].sort());
  for (const key of wordmarkKeys) {
    const reviewed = inventory.reviewedOverrides[key];
    assert.equal(reviewed.workflowRun, 41371319485);
    assert.equal(reviewed.artifactId, 13109317665);
    assert.equal(reviewed.gitCommit, "42707dd63bd61adf581b541987340329ff5a6152");
    assert.match(reviewed.reason, /AttoLang-wordmark/u);
  }
  const expectedArchiveShas = {
    "chromium-375-archive.png": "6481db059df5d4480143b8b85be45327c524d0854e1b3859d32c7bb6d1f26d08",
    "chromium-1440-archive.png": "08356f3b1890d93a60ff7a21b855f003d5057d574a9f404d321db570b1d8b61c",
    "firefox-375-archive.png": "80ed3fad18d29ba6aeadae2ff7f79f192ca8ab91fa95005ba56710c2931c8c9b",
    "firefox-1440-archive.png": "0ba3f5bf8b58f3033e984a554fa4e33fe36f8b669faaccd4313e35aebb0eb16c",
    "webkit-375-archive.png": "f03d8d0b0624c48de72b487f375e2be043c765bd7194e7d94488bf1ff8fcd28c",
    "webkit-1440-archive.png": "450b6a15108c54ed21628e1ae25743b1f666ed00b01723e4c5d757adcbf61059",
  };
  for (const key of archiveKeys) {
    const reviewed = inventory.reviewedOverrides[key];
    if (key.includes("-375-")) {
      // These three specific archive snapshots were inspected at full size,
      // and their PNG hashes pinned to an actual, immutable Actions artifact.
      // This is not permission to refresh any other baseline or relax thresholds.
      assert.equal(reviewed.workflowRun, 42078761971);
      assert.equal(reviewed.artifactId, 13452567455);
      assert.equal(reviewed.gitCommit, "b6689bc0097462b6c3c89c1fcd40cb57adde2fbf");
      assert.match(reviewed.reason, /Reviewed full 375×900 CI screenshot/u);
      assert.match(reviewed.reason, /Independent external review requested/u);
    } else {
      // Preserve previous independently reviewed provenance for desktop.
      assert.equal(reviewed.workflowRun, 41705051657);
      assert.equal(reviewed.artifactId, 13265103401);
      assert.equal(reviewed.gitCommit, "8ee59ebd30c40951a298f5b3369705b9f47598f3");
      assert.match(reviewed.reason, /Reviewed all six full-size archive screenshots/u);
    }
    assert.equal(inventory.images[key].pngSha256, expectedArchiveShas[key],
      "Archive screenshot hash must match the reviewed artifact");
  }
  const files = Object.keys(inventory.images);
  assert.equal(files.length, 18);
  for (const engine of ["chromium", "firefox", "webkit"]) {
    for (const width of [375, 1440]) {
      for (const route of ["archive", "log-6", "log-7"]) {
        const key = engine + "-" + width + "-" + route + ".png";
        const entry = inventory.images[key];
        assert.ok(entry, "Missing visual baseline " + key);
        assert.match(entry.pngSha256, /^[0-9a-f]{64}$/u);
        assert.equal(inflateSync(Buffer.from(entry.sampleZlibBase64, "base64")).length,
          BYTE_COUNT, "Malformed visual baseline for " + key);
      }
    }
  }
});

test("large or localized color changes fail visual comparison without reapproval", () => {
  const entry = inventory.images["chromium-375-log-6.png"];
  const original = inflateSync(Buffer.from(entry.sampleZlibBase64, "base64"));
  const changed = Buffer.from(original);
  for (let cell = 0; cell < 36; cell++) {
    for (let channel = 0; channel < 3; channel++) {
      changed[cell * 3 + channel] = changed[cell * 3 + channel] > 128 ? 0 : 255;
    }
  }
  assert.throws(() => compareVisual("chromium-375-log-6.png",
    Buffer.from("changed-image"), changed, entry), /visual regression/u);
  assert.doesNotThrow(() => compareVisual("chromium-375-log-6.png",
    Buffer.from("different-PNG-encoding"), original, entry));
});

test("visual verification rejects corrupt PNG headers, mismatched dimensions and huge screenshots", () => {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12, "ascii");
  png.writeUInt32BE(375, 16);
  png.writeUInt32BE(900, 20);
  png[24] = 8;
  png[25] = 6;
  assert.doesNotThrow(() => checkScreenshotPng("fixture", png, 375));
  assert.throws(() => checkScreenshotPng("fixture", png, 1440), /screenshot width/u);
  assert.throws(() => checkScreenshotPng("fixture", png, 375, 700), /screenshot height/u);
  const badMagic = Buffer.from(png);
  badMagic[1] = 0;
  assert.throws(() => checkScreenshotPng("fixture", badMagic, 375), /PNG magic/u);
  const badType = Buffer.from(png);
  badType[25] = 0;
  assert.throws(() => checkScreenshotPng("fixture", badType, 375), /color type/u);
  assert.throws(() => checkScreenshotPng("fixture", Buffer.alloc(5_000_000), 375), /PNG byte length/u);
});

test("matching PNG SHA cannot bypass mismatched or corrupt perceptual signature", () => {
  const screenshot = Buffer.from("approved-image");
  const pngSha256 = createHash("sha256").update(screenshot).digest("hex");
  const zeros = Buffer.alloc(BYTE_COUNT);
  const image = { pngSha256, sampleZlibBase64: deflateSync(zeros).toString("base64") };
  assert.doesNotThrow(() => compareVisual("fixture", screenshot, zeros, image));
  const changed = Buffer.from(zeros);
  changed[0] = 255;
  assert.throws(() => compareVisual("fixture", screenshot, changed, image), /signature differs/u);
  const oversized = { pngSha256, sampleZlibBase64: deflateSync(Buffer.alloc(BYTE_COUNT + 512)).toString("base64") };
  assert.throws(() => compareVisual("fixture", screenshot, zeros, oversized));
  assert.throws(() => compareVisual("fixture", screenshot, Buffer.alloc(10), image),
    /normalized pixel buffer/u);
});
