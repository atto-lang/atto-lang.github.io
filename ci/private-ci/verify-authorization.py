#!/usr/bin/env python3
"""Validate source-free external private-CI authorization manifests."""
import datetime as dt
import json
from pathlib import Path, PurePosixPath
import re
import sys

HEX40 = re.compile(r"^[0-9a-f]{40}$")
REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$")
SCHEMA = "ores-private-ci-external-authorization-v1"
EXPECTED_SOURCE = "ores-truffle-oreslang/oreslang-source.java"
EXPECTED_SOURCE_ID = 1400792274
EXPECTED_ANCHOR_ID = 1409246164

class Denied(ValueError):
    pass

def unique_object(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise Denied("duplicate JSON key")
        out[key] = value
    return out

def sha(value, label):
    if not isinstance(value, str) or not HEX40.fullmatch(value):
        raise Denied(label + " must be a lowercase 40-hex Git SHA")
    return value

def repo(value, label):
    if not isinstance(value, str) or not REPO.fullmatch(value):
        raise Denied(label + " is invalid")
    return value

def safe_path(value, prefix, suffix):
    if not isinstance(value, str) or not value.startswith(prefix) or not value.endswith(suffix):
        raise Denied("unsafe pinned path")
    p = PurePosixPath(value)
    if value.startswith("/") or "\\" in value or ".." in p.parts or ".git" in p.parts:
        raise Denied("unsafe pinned path")
    return value

def positive_int(value, label):
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise Denied(label + " must be a positive integer")
    return value

def validate(doc, now=None):
    if not isinstance(doc, dict) or set(doc) != {
        "schema", "anchor_repository_id", "source", "destination", "constraints"
    }:
        raise Denied("manifest fields are not exact")
    if doc["schema"] != SCHEMA:
        raise Denied("unsupported manifest schema")
    if doc["anchor_repository_id"] != EXPECTED_ANCHOR_ID:
        raise Denied("anchor repository identity mismatch")

    source = doc["source"]
    if not isinstance(source, dict) or set(source) != {
        "repository", "repository_id", "base_branch", "pr", "head_sha", "tree_sha"
    }:
        raise Denied("source fields are not exact")
    if repo(source["repository"], "source repository") != EXPECTED_SOURCE:
        raise Denied("wrong source repository")
    if source["repository_id"] != EXPECTED_SOURCE_ID:
        raise Denied("source repository identity mismatch")
    if source["base_branch"] != "main":
        raise Denied("source base branch must be main")
    positive_int(source["pr"], "source PR")
    sha(source["head_sha"], "source head")
    sha(source["tree_sha"], "source tree")

    destination = doc["destination"]
    if not isinstance(destination, dict) or set(destination) != {
        "repository", "repository_id", "base_sha", "workflow_path",
        "workflow_blob_sha", "test_plan_path", "test_plan_blob_sha"
    }:
        raise Denied("destination fields are not exact")
    repo(destination["repository"], "destination repository")
    positive_int(destination["repository_id"], "destination repository id")
    sha(destination["base_sha"], "destination base")
    safe_path(destination["workflow_path"], ".github/workflows/", ".yml")
    sha(destination["workflow_blob_sha"], "workflow blob")
    safe_path(destination["test_plan_path"], "ci/test-plans/", ".json")
    if destination["test_plan_path"] != f"ci/test-plans/java-pr{source['pr']}.json":
        raise Denied("test-plan path must match source PR")
    sha(destination["test_plan_blob_sha"], "test-plan blob")

    constraints = doc["constraints"]
    if not isinstance(constraints, dict) or set(constraints) != {
        "source_must_be_private", "destination_must_be_private",
        "source_tree_prefix", "source_ref_template",
        "authorization_ref_template", "control_ref_template",
        "receipt_schema", "expires_at"
    }:
        raise Denied("constraint fields are not exact")
    if constraints["source_must_be_private"] is not True or constraints["destination_must_be_private"] is not True:
        raise Denied("private visibility constraints are mandatory")
    if constraints["source_tree_prefix"] != "private-oreslang-source":
        raise Denied("unexpected source tree prefix")
    if constraints["source_ref_template"] != "ci/oreslang-{source_tree_sha}":
        raise Denied("unexpected source ref template")
    if constraints["authorization_ref_template"] != "ci/authorized-{carrier_commit_sha}":
        raise Denied("unexpected authorization ref template")
    if constraints["control_ref_template"] != "ci/oreslang-control-{carrier_commit_sha}":
        raise Denied("unexpected control ref template")
    if constraints["receipt_schema"] != "ores-private-ci-receipt-v4":
        raise Denied("unexpected receipt schema")
    expiry_text = constraints["expires_at"]
    if not isinstance(expiry_text, str) or not expiry_text.endswith("Z"):
        raise Denied("expiry must use canonical UTC Z form")
    try:
        expires = dt.datetime.fromisoformat(expiry_text[:-1] + "+00:00")
    except ValueError as exc:
        raise Denied("invalid expiry") from exc
    if now is not None:
        if expires <= now:
            raise Denied("authorization expired")
        if expires - now > dt.timedelta(days=7):
            raise Denied("authorization retention exceeds seven days")
    return doc

def load(path):
    raw = Path(path).read_bytes()
    if not raw or len(raw) > 64 * 1024:
        raise Denied("manifest missing or oversized")
    return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)

def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        print("usage: verify-authorization.py MANIFEST", file=sys.stderr)
        return 2
    try:
        validate(load(argv[0]), now=dt.datetime.now(dt.timezone.utc))
    except (Denied, UnicodeError, json.JSONDecodeError, OSError) as exc:
        print("PRIVATE_CI_ANCHOR_REJECTED: " + str(exc), file=sys.stderr)
        return 1
    print("PRIVATE_CI_ANCHOR_VALID")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
