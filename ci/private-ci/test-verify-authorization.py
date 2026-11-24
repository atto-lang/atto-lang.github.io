#!/usr/bin/env python3
import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("anchor", HERE / "verify-authorization.py")
anchor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(anchor)
DOC = json.loads((HERE / "authorizations/java-pr1668.json").read_text())

class Tests(unittest.TestCase):
    def test_current_manifest(self):
        anchor.validate(copy.deepcopy(DOC), dt.datetime(2026,10,21,tzinfo=dt.timezone.utc))

    def test_codeowners_covers_anchor_control_plane(self):
        root = HERE.parents[1]
        lines = {
            line.strip()
            for line in (root / ".github" / "CODEOWNERS").read_text().splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        }
        required = {
            "/ci/private-ci/ @ORESoftware",
            "/.github/workflows/private-ci-anchor.yml @ORESoftware",
            "/.github/CODEOWNERS @ORESoftware",
        }
        self.assertEqual(set(), required - lines)

    def test_unknown_field_fails_closed(self):
        doc=copy.deepcopy(DOC); doc["shell"]="bash"
        with self.assertRaises(anchor.Denied): anchor.validate(doc)

    def test_source_identity_is_fixed(self):
        doc=copy.deepcopy(DOC); doc["source"]["repository_id"] += 1
        with self.assertRaises(anchor.Denied): anchor.validate(doc)

    def test_head_and_tree_must_be_exact_shas(self):
        for field in ("head_sha","tree_sha"):
            doc=copy.deepcopy(DOC); doc["source"][field]="main"
            with self.assertRaises(anchor.Denied): anchor.validate(doc)

    def test_destination_must_remain_private(self):
        doc=copy.deepcopy(DOC); doc["constraints"]["destination_must_be_private"]=False
        with self.assertRaises(anchor.Denied): anchor.validate(doc)

    def test_expiry_fails_closed(self):
        with self.assertRaisesRegex(anchor.Denied, "expired"):
            anchor.validate(copy.deepcopy(DOC), dt.datetime(2026,10,29,tzinfo=dt.timezone.utc))

if __name__ == "__main__":
    unittest.main()
