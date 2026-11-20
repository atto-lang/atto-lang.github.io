import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scopes = ["src/pages", "src/components", "src/layouts", "src/data", "public/language"];
const extensions = /\.(?:astro|mjs|md|txt|json|svg)$/u;
const formerBrand = /\bOres[Ll]ang\b/gu;
// Exact legacy phrases in legally fixed or immutable evidence artifacts, not current product copy.
// These must remain narrowly scoped: any other old product-name occurrence fails the test.
const protectedHistoricalText = new Map([
  ["src/data/lima27.mjs", "The grant concerns copyrightable Software, not independent use of the Oreslang language syntax or an independently implemented compatible language."],
  ["src/data/schemas/oreslang-http-sweep-v1.schema.json", '"title": "Oreslang HTTP offered-load sweep evidence receipt (public report v1)"'],
]);
// Lowercase oreslang inside existing URLs, file/grammar identifiers, and historic prompts
// is deliberately not rewritten. New product prose must use AttoLang.
function visit(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = join(dir, entry.name);
    return entry.isDirectory() ? visit(rel) : extensions.test(rel) ? [rel] : [];
  });
}

test("current public-facing source copy does not regress to the previous product display name", () => {
  const bad = [];
  for (const path of scopes.flatMap(visit)) {
    const contents = readFileSync(join(root, path), "utf8");
    const matches = [...contents.matchAll(formerBrand)];
    for (const match of matches) {
      const line = contents.slice(0, match.index).split("\n").length;
      const sourceLine = contents.split("\n")[line - 1];
      if (protectedHistoricalText.get(path) && sourceLine.includes(protectedHistoricalText.get(path))) continue;
      // The single About-page migration sentence is explicitly historical, not an old product label.
      if (path === "src/pages/about.astro" && sourceLine.includes("AttoLang was formerly known as Oreslang.")) continue;
      // A single explicit schema.org alternateName line preserves former-name SEO.
      if (path === "src/layouts/BaseLayout.astro" &&
          sourceLine.includes('alternateName: ["Oreslang", "OresLang"]')) continue;
      bad.push(path + ":" + line + " (" + match[0] + ")");
    }
  }
  assert.deepEqual(bad, [], "Review each display-name occurrence; add a narrow, documented exception only for a truly historical quote");
});
