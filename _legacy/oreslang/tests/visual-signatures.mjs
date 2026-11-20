import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

export const WIDTH = 32;
export const HEIGHT = 24;
const COMPONENTS = 3;
export const BYTE_COUNT = WIDTH * HEIGHT * COMPONENTS;

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_VISUAL_BYTES = 4 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 10 * 1024;

/** Reject corrupt, wrong-sized or unexpectedly huge artifacts before comparison. */
export function checkScreenshotPng(name, screenshot, expectedWidth, expectedHeight = 900) {
  assert.ok(Buffer.isBuffer(screenshot), name + " must be a PNG Buffer");
  assert.ok(screenshot.length >= 33 && screenshot.length <= MAX_VISUAL_BYTES,
    name + " invalid or excessive PNG byte length " + screenshot.length);
  assert.ok(screenshot.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC),
    name + " invalid PNG magic bytes");
  assert.equal(screenshot.toString("ascii", 12, 16), "IHDR", name + " missing PNG IHDR");
  assert.equal(screenshot.readUInt32BE(16), expectedWidth, name + " screenshot width");
  assert.equal(screenshot.readUInt32BE(20), expectedHeight, name + " screenshot height");
  // Only canonical 8-bit PNG color representations are accepted.
  assert.equal(screenshot[24], 8, name + " unexpected PNG color bit depth");
  assert.ok([2, 6].includes(screenshot[25]), name + " unsupported PNG color type");
}


export async function normalizedPixels(page, screenshot) {
  // Decode actual Playwright PNGs through a pinned browser; no optional native
  // image libraries or system-specific screenshot converter are required.
  const encoded = screenshot.toString("base64");
  const bytes = await page.evaluate(async (pngBase64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + pngBase64;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const rgb = [];
    for (let i = 0; i < rgba.length; i += 4) {
      rgb.push(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
    return rgb;
  }, encoded);
  assert.equal(bytes.length, BYTE_COUNT, "Unexpected visual signature length");
  return Buffer.from(bytes);
}

export function makeBaseline(imageBytes, pixels) {
  assert.equal(pixels.length, BYTE_COUNT);
  return {
    pngSha256: createHash("sha256").update(imageBytes).digest("hex"),
    sampleZlibBase64: deflateSync(pixels, { level: 9 }).toString("base64"),
  };
}

export function compareVisual(name, imageBytes, pixels, entry) {
  assert.ok(entry, "No approved visual baseline for " + name);
  assert.match(entry.pngSha256, /^[a-f0-9]{64}$/u);
  assert.ok(Buffer.isBuffer(pixels) && pixels.length === BYTE_COUNT,
    name + " incomplete normalized pixel buffer");
  assert.ok(typeof entry.sampleZlibBase64 === "string" &&
    entry.sampleZlibBase64.length > 0 && entry.sampleZlibBase64.length <= MAX_SIGNATURE_BYTES,
    name + " invalid visual baseline signature");
  const original = inflateSync(Buffer.from(entry.sampleZlibBase64, "base64"), {
    maxOutputLength: BYTE_COUNT,
  });
  assert.equal(original.length, BYTE_COUNT, "Corrupt baseline for " + name);
  const actualHash = createHash("sha256").update(imageBytes).digest("hex");
  if (actualHash === entry.pngSha256) {
    // Do not allow an inconsistent baseline to bypass the semantic pixel check.
    assert.ok(pixels.equals(original), name + " screenshot digest matches but visual signature differs");
    return { exact: true, mean: 0, changed: 0 };
  }
  let total = 0, changedCells = 0, largest = 0;
  for (let i = 0; i < BYTE_COUNT; i += COMPONENTS) {
    const cell = (
      Math.abs(pixels[i] - original[i]) +
      Math.abs(pixels[i + 1] - original[i + 1]) +
      Math.abs(pixels[i + 2] - original[i + 2])
    ) / COMPONENTS;
    total += cell;
    largest = Math.max(largest, cell);
    if (cell > 18) changedCells++;
  }
  const mean = total / (WIDTH * HEIGHT);
  // Small antialias/font differences are permitted; layout, missing sections,
  // color-system changes and significant title shifts require visual review.
  assert.ok(mean <= 4.0 && changedCells <= 12,
    name + " visual regression mean=" + mean.toFixed(2) +
    " significantCells=" + changedCells + " peak=" + largest.toFixed(2) +
    "; inspect visual-review artifact before approving a baseline refresh");
  return { exact: false, mean: Math.round(mean * 100) / 100, changed: changedCells };
}
