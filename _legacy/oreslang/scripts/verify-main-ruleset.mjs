import assert from "node:assert/strict";

const TARGET = "refs/heads/main";
const CHECK = "AttoLang Site Validation";
const ACTIONS_APP = 15368;

export function assertMainRuleset(rule) {
  assert.equal(rule?.target, "branch", "branch target required");
  assert.equal(rule.enforcement, "active", "ruleset must be active");
  assert.deepEqual(rule.bypass_actors, [], "no broad bypass actors permitted");
  assert.deepEqual(rule.conditions?.ref_name?.include, [TARGET], "main branch must be explicitly targeted");
  assert.deepEqual(rule.conditions?.ref_name?.exclude, [], "no branch exclusions permitted");
  const names = rule.rules?.map(r => r.type);
  assert.deepEqual([...names].sort(),
    ["deletion", "non_fast_forward", "pull_request", "required_status_checks"].sort(),
    "all safety rules required, without unreviewed extra rules");
  const pr = rule.rules.find(r => r.type === "pull_request").parameters;
  assert.deepEqual(pr.allowed_merge_methods, ["merge"], "merge method must be explicit");
  for (const prop of ["dismiss_stale_reviews_on_push", "require_last_push_approval",
    "required_review_thread_resolution"]) {
    assert.equal(pr[prop], true, prop + " must be enabled");
  }
  assert.equal(pr.require_code_owner_review, true, "codeowner approval required");
  assert.ok(pr.required_approving_review_count >= 1, "independent approval required");
  const checks = rule.rules.find(r => r.type === "required_status_checks").parameters;
  assert.equal(checks.strict_required_status_checks_policy, true, "head must be current with main");
  assert.deepEqual(checks.required_status_checks,
    [{context: CHECK, integration_id: ACTIONS_APP}],
    "pin unique GitHub Actions check name and integration ID");
  return true;
}

export function assessMergeEvidence({ruleset, currentHead, checkRuns, reviews, prAuthor,
  lastPusher, baseIsCurrent, unresolvedThreads}) {
  const blockers = [];
  try { assertMainRuleset(ruleset); } catch (e) {
    blockers.push("Ruleset not verified: " + e.message);
  }
  if (!/^[0-9a-f]{40}$/u.test(currentHead ?? "")) blockers.push("Missing exact PR head SHA");
  if (baseIsCurrent !== true) blockers.push("PR base is not verified current");
  if (unresolvedThreads !== false) blockers.push("Unresolved review-thread status not verified");
  if (typeof prAuthor !== "string" || !prAuthor || typeof lastPusher !== "string" || !lastPusher) {
    blockers.push("Author and last-pusher identity missing");
  }
  const checks = (Array.isArray(checkRuns) ? checkRuns : []).filter(c =>
    c.name === CHECK && c.head_sha === currentHead && c.app?.id === ACTIONS_APP &&
    c.status === "completed" && c.conclusion === "success");
  if (checks.length !== 1) blockers.push("Exactly one successful exact-head GitHub Actions check required");
  const approved = (Array.isArray(reviews) ? reviews : []).filter(rv =>
    rv.state === "APPROVED" && rv.commit_id === currentHead &&
    rv.user?.login && rv.user.login !== prAuthor && rv.user.login !== lastPusher);
  if (approved.length < 1) blockers.push("Independent exact-head approval missing");
  if ((Array.isArray(reviews) ? reviews : []).some(rv => rv.state === "CHANGES_REQUESTED")) {
    blockers.push("Outstanding changes-requested review");
  }
  // This cannot establish that two GitHub identities are socially independent
  // or that GitHub has actually applied the proposed ruleset.
  return {ready: blockers.length === 0, blockers};
}
