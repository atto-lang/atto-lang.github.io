import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Convert only reviewed, checked-in AttoLang vector assets. No network or new font.
const publicRoot = new URL("../public/", import.meta.url);
const output = new URL("../public/brand/", import.meta.url);
await mkdir(fileURLToPath(output), { recursive: true });
const get = (name) => readFile(new URL(name, publicRoot), "utf8");
const [black, white, favicon, social] = await Promise.all([
  get("attolang-wordmark.svg"),
  get("attolang-wordmark-light.svg"),
  get("favicon.svg"),
  get("social-preview.svg"),
]);
assert.equal(white, black.replace('fill="#000"', 'fill="#fff"'),
  "The two wordmark variants must share the exact same contours");
assert.match(social, /viewBox="0 0 1200 630"/u);
assert.match(favicon, /viewBox="0 0 64 64"/u);
for (const svg of [black, white, favicon, social]) {
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|\bhref\s*=/iu,
    "Brand assets must be self-contained and free from external references");
}

await Promise.all([
  sharp(Buffer.from(black)).resize(1100, 283, { fit: "contain" })
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL("attolang-black.png", output))),
  sharp(Buffer.from(white)).resize(1100, 283, { fit: "contain" })
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL("attolang-white.png", output))),
  sharp(Buffer.from(social))
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL("attolang-social.png", output))),
  sharp(Buffer.from(favicon)).resize(180, 180)
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL("attolang-icon-180.png", output))),
  writeFile(new URL("attolang-social.svg", output), social),
]);
console.log("Built AttoLang SVG/PNG brand assets from checked-in source artwork");
