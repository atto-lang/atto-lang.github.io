import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { excludedOrganizations, excludedIndividuals, lima27LicenseText } from "../src/data/lima27.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/pages/licenses.astro");
const nav = read("../src/components/SiteNav.astro");
const layout = read("../src/layouts/BaseLayout.astro");
const endpoint = read("../src/pages/licenses/lima-27.txt.ts");

test("Lima 27 excludes all seven requested organizations and one individual", () => {
  assert.equal(excludedOrganizations.length, 7);
  assert.deepEqual(excludedIndividuals, ["Taylor Swift"]);
  for (const name of ["Amazon", "Google", "Apple", "Facebook", "Jane Street", "CIA", "Mossad"]) {
    assert.ok(excludedOrganizations.some((organization) => organization.includes(name)), name);
  }
  for (const name of ["Amazon.com, Inc.", "Google LLC", "Alphabet Inc.", "Apple Inc.", "Meta Platforms, Inc.", "Jane Street Group, LLC", "Central Intelligence Agency (CIA)", "Institute for Intelligence and Special Operations (Mossad)", "Taylor Swift"]) {
    assert.ok(lima27LicenseText.includes(name), "License is missing " + name);
  }
});

test("grant, restrictions and license classification are not contradictory", () => {
  for (const clause of [
    "Version 1.1", "royalty-free", "source or compiled form", "for personal or commercial purposes",
    "No rights or permissions are granted", "acting on behalf of any Excluded Party",
    "Receiving a copy", "independently obtained", "complete License",
    "does not automatically extend to other government agencies",
    "For a corporate organization named above",
    "does not meet the Open Source Initiative's Open Source Definition",
    "does not, by itself, change the license of another project",
    "independent use of the Oreslang language syntax",
    "AS IS",
  ]) {
    assert.ok(lima27LicenseText.includes(clause), "Missing license qualification " + clause);
  }
  assert.ok(!/\bOSI-approved open-source license\b\s*(?:is|are)/u.test(lima27LicenseText));
});

test("licenses page and plain-text endpoint share the one canonical text", () => {
  assert.ok(page.includes('import { excludedOrganizations, excludedIndividuals, lima27LicenseText }'));
  assert.ok(page.includes("{excludedOrganizations.map("));
  assert.ok(page.includes("{excludedIndividuals.map("));
  assert.ok(page.includes('{lima27LicenseText}'));
  assert.ok(page.includes('href="/licenses/lima-27.txt"'));
  assert.ok(page.includes("automatically relicense"));
  assert.ok(page.includes("not open source"));
  assert.ok(endpoint.includes('import { lima27LicenseText } from "../../data/lima27.mjs"'));
  assert.ok(endpoint.includes('new Response(lima27LicenseText + "\\n"'));
  assert.ok(endpoint.includes('"Content-Type": "text/plain; charset=utf-8"'));
});

test("licenses route is discoverable on desktop, mobile, and footer", () => {
  assert.ok(nav.includes('label: "licenses", href: "/licenses/"'));
  assert.ok(nav.includes('{links.map((link) => <a href={link.href}>{link.label}</a>)}'));
  assert.ok(layout.includes('<a href="/licenses/">Licenses</a>'));
});
