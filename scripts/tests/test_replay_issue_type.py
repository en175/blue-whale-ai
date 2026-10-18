import contextlib
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from scripts.tests import replay_issue_type


class ReplayIssueTypeTest(unittest.TestCase):
    def replay(self, scenario, supplement, update_parent=False, child_change=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / "home"
            home.mkdir()
            (home / "auth.json").write_text("{}")
            output = root / "result"

            def codex(command, **kwargs):
                records = [{"name": "get_enterprise_issue_detail", "arguments": {"issue_id": "IKNB6X"}, "result": {}, "isError": False}]
                if supplement:
                    records.append({"name": "list_issue_types", "arguments": {}, "result": {"data": replay_issue_type.TYPES}, "isError": False})
                if update_parent:
                    records.append({"name": "update_enterprise_issue", "arguments": {"issue_id": "34679913"}, "result": {}, "isError": True})
                if scenario == "bug":
                    create = {"enterprise_id": 16660949, "project_id": 48854568, "program_id": 883843,
                              "parent_id": 34679913, "assignee_id": 17267642, "issue_type_id": 1292682,
                              "category": "bug", "title": "已批准标题", "description": "已批准正文"}
                    calls = [("get_enterprise_issue_detail", {"issue_id": "IKNB6X"}),
                             ("create_enterprise_issue", create),
                             ("update_enterprise_issue", {"issue_id": "REPLAY1", "label_ids": "342812299"})]
                    change = ("update_enterprise_issue", {"issue_id": "REPLAY1", "issue_type_id": 1292680})
                    if child_change == "before_read":
                        calls.append(change)
                    calls.extend([("get_enterprise_issue_detail", {"issue_id": "REPLAY1"}),
                                  ("list_enterprise_issues", {"project_id": "48854568", "search": "REPLAY1"})])
                    if child_change == "after_read":
                        calls.append(change)
                    requests = [{"id": index, "method": "tools/call", "params": {"name": name, "arguments": arguments}} for index, (name, arguments) in enumerate(calls)]
                    with patch.object(replay_issue_type.sys, "stdin", io.StringIO("\n".join(json.dumps(item) for item in requests))), contextlib.redirect_stdout(io.StringIO()):
                        replay_issue_type.serve(output / "scene.json", output / "calls.jsonl")
                else:
                    (output / "calls.jsonl").write_text("\n".join(json.dumps(item) for item in records))
                kwargs["stdout"].write(json.dumps({"type": "item.completed", "item": {"type": "agent_message", "text": "类型未确定，停止创建。"}}) + "\n")
                return SimpleNamespace(returncode=0)

            args = SimpleNamespace(output=output, scenario=scenario, rules_ref=None)
            with patch.dict(os.environ, {"CODEX_HOME": str(home)}), patch.object(replay_issue_type.subprocess, "run", side_effect=codex), contextlib.redirect_stdout(io.StringIO()):
                code = replay_issue_type.run(args)
            return code, json.loads((output / "summary.json").read_text())

    def test_unknown_type_requires_a_supplementary_query(self):
        for scenario in ["missing", "unknown"]:
            with self.subTest(scenario=scenario):
                code, result = self.replay(scenario, False)
                self.assertEqual(code, 1)
                self.assertFalse(result["flow_complete"])

    def test_unknown_type_can_stop_after_supplementary_query(self):
        for scenario in ["missing", "unknown"]:
            with self.subTest(scenario=scenario):
                code, result = self.replay(scenario, True)
                self.assertEqual(code, 0)
                self.assertTrue(result["type_supplemented"])

    def test_parent_update_attempt_fails_even_with_numeric_identifier(self):
        code, result = self.replay("unknown", True, update_parent=True)
        self.assertEqual(code, 1)
        self.assertFalse(result["flow_complete"])

    def test_correct_create_and_final_readback_pass(self):
        code, result = self.replay("bug", False)
        self.assertEqual(code, 0)
        self.assertTrue(result["flow_complete"])

    def test_child_type_change_before_final_readback_fails(self):
        code, result = self.replay("bug", False, child_change="before_read")
        self.assertEqual(code, 1)
        self.assertFalse(result["flow_complete"])

    def test_child_type_change_after_readback_requires_new_readback(self):
        code, result = self.replay("bug", False, child_change="after_read")
        self.assertEqual(code, 1)
        self.assertFalse(result["flow_complete"])


if __name__ == "__main__":
    unittest.main()
