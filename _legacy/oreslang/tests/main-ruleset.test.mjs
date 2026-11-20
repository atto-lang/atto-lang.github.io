import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assertMainRuleset, assessMergeEvidence} from "../scripts/verify-main-ruleset.mjs";

const load = () => JSON.parse(readFileSync(new URL("../.github/policies/main-ruleset.proposed.json", import.meta.url), "utf8"));
const SHA = "c".repeat(40);
const receipt = () => ({
  ruleset: load(), currentHead: SHA, baseIsCurrent: true, unresolvedThreads: false,
  prAuthor: "author", lastPusher: "author",
  checkRuns: [{
    name: "AttoLang Site Validation", head_sha: SHA, status:"completed",
    conclusion:"success", app:{id:15368, slug:"github-actions"}
  }],
  reviews:[{state:"APPROVED", commit_id:SHA, user:{login:"independent-human"}}]
});
const fail = (edit, fragment) => {
  const r = receipt(); edit(r); const result = assessMergeEvidence(r);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(x => x.includes(fragment)), JSON.stringify(result.blockers));
};

test("proposed ruleset is a static admin template, not evidence of active enforcement", () => {
  const config = load();
  assert.equal(assertMainRuleset(config), true);
  assert.equal(config.enforcement, "active", "administrator should apply it in active mode");
  const owners = readFileSync(new URL("../.github/CODEOWNERS", import.meta.url), "utf8");
  assert.match(owners, /^\* @ORESoftware @the1mills$/mu,
    "both trusted non-self-review options must be recorded");
  const doc = readFileSync(new URL("../docs/MAIN_BRANCH_GOVERNANCE.md", import.meta.url), "utf8");
  assert.match(doc, /not applied|not installed/iu);
  assert.match(doc, /administrator/u);
  const workflow = readFileSync(new URL("../.github/workflows/validate-site.yml", import.meta.url), "utf8");
  assert.match(workflow, /^    name: AttoLang Site Validation$/mu);
  assert.match(workflow, /^  pull_request:\s*$/mu);
  assert.doesNotMatch(workflow, /^\s+(?:paths|paths-ignore|branches|branches-ignore):/mu);
});

test("synthetic approved exact-head receipt is structurally accepted only", () => {
  const result = assessMergeEvidence(receipt());
  assert.deepEqual(result, {ready:true,blockers:[]});
});

test("inactive, bypassable, unscoped, review-free or weak rulesets fail", () => {
  for (const change of [
    r => {r.ruleset.enforcement = "disabled";},
    r => {r.ruleset.bypass_actors.push({actor_id:1,actor_type:"RepositoryRole",bypass_mode:"always"});},
    r => {r.ruleset.conditions.ref_name.include = ["~ALL"];},
    r => {r.ruleset.rules = r.ruleset.rules.filter(x => x.type !== "deletion");},
    r => {r.ruleset.rules.find(x => x.type === "pull_request").parameters.required_approving_review_count=0;},
    r => {r.ruleset.rules.find(x => x.type === "pull_request").parameters.require_code_owner_review=false;},
    r => {r.ruleset.rules.find(x => x.type === "pull_request").parameters.require_last_push_approval=false;},
    r => {r.ruleset.rules.find(x => x.type === "required_status_checks").parameters.strict_required_status_checks_policy=false;},
    r => {r.ruleset.rules.find(x => x.type === "required_status_checks").parameters.required_status_checks[0].integration_id=12345;}
  ]) fail(change, "Ruleset not verified");
});

test("missing check, wrong app, wrong SHA, skipped run and self review all fail", () => {
  fail(r=>{r.checkRuns=[];}, "Exactly one successful");
  fail(r=>{r.checkRuns[0].app.id=123;}, "Exactly one successful");
  fail(r=>{r.checkRuns[0].head_sha="d".repeat(40);}, "Exactly one successful");
  fail(r=>{r.checkRuns[0].status="skipped";}, "Exactly one successful");
  fail(r=>{r.reviews=[];}, "Independent exact-head");
  fail(r=>{r.reviews[0].user.login="author";}, "Independent exact-head");
  fail(r=>{r.reviews[0].commit_id="d".repeat(40);}, "Independent exact-head");
  fail(r=>{r.lastPusher="independent-human";}, "Independent exact-head");
});

test("outdated base, unresolved threads and changes requested reject merge receipt", () => {
  fail(r=>{r.baseIsCurrent=false;}, "base is not");
  fail(r=>{r.unresolvedThreads=true;}, "review-thread");
  fail(r=>{r.reviews.push({state:"CHANGES_REQUESTED", user:{login:"another"}});}, "Outstanding changes-requested");
  fail(r=>{r.currentHead="not-a-sha";}, "Missing exact PR head");
});
