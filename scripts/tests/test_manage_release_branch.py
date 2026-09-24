#!/usr/bin/env python3
"""Black-box release-line tests against a temporary bare Git remote."""

import datetime as dt
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    from .bash_helper import BASH
except ImportError:
    from bash_helper import BASH

SCRIPTS = Path(__file__).resolve().parents[1]


def run(*argv, cwd, check=True):
    result = subprocess.run(
        [str(x) for x in argv], cwd=cwd, text=True, encoding="utf-8",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode:
        raise AssertionError(f"{' '.join(map(str, argv))}\n{result.stdout}\n{result.stderr}")
    return result


class ReleaseLineFixture:
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bare = self.root / "origin.git"
        self.repo = self.root / "main"
        run("git", "init", "--bare", "--initial-branch=master", self.bare, cwd=self.root)
        run("git", "init", "--initial-branch=master", self.repo, cwd=self.root)
        run("git", "config", "user.name", "Release Test", cwd=self.repo)
        run("git", "config", "user.email", "release@example.com", cwd=self.repo)
        (self.repo / "scripts" / "lib").mkdir(parents=True)
        for name in ("manage-release-branch.sh", "start-task-worktree.py", "sync-release-line.sh", "sync-release-line.py"):
            shutil.copy2(SCRIPTS / name, self.repo / "scripts" / name)
        for name in ("python3-command.sh", "release-line-state.py", "release_line_sync.py", "task_metadata.py"):
            shutil.copy2(SCRIPTS / "lib" / name, self.repo / "scripts" / "lib" / name)
        (self.repo / "base.txt").write_text("base\n", encoding="utf-8")
        run("git", "add", ".", cwd=self.repo)
        run("git", "commit", "-m", "chore: test base", cwd=self.repo)
        run("git", "remote", "add", "origin", self.bare, cwd=self.repo)
        run("git", "push", "origin", "master", cwd=self.repo)

    def command(self, *args):
        return run(BASH, self.repo / "scripts/manage-release-branch.sh",
                   *args, cwd=self.repo, check=False)

    def release(self, name, with_commit=False):
        run("git", "branch", name, cwd=self.repo)
        if with_commit:
            run("git", "checkout", name, cwd=self.repo)
            run("git", "commit", "--allow-empty", "-m", "feat: release content", cwd=self.repo)
            run("git", "checkout", "master", cwd=self.repo)
        run("git", "push", "origin", name, cwd=self.repo)

    def snapshot(self, pulls=None):
        path = self.root / "pulls.json"
        path.write_text(json.dumps({
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "project_id": 48854568,
            "state": "open",
            "complete": True,
            "pulls": pulls or [],
        }), encoding="utf-8")
        return path


class ReleaseLineTest(ReleaseLineFixture, unittest.TestCase):
    def test_create_records_one_active_line_and_current_selects_it(self):
        created = self.command("create", "--summary", "发布流程验证", "--user-authorized", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        branch = json.loads(created.stdout)["branch"]
        current = self.command("current", "--json")
        self.assertEqual(0, current.returncode, current.stderr)
        data = json.loads(current.stdout)
        self.assertEqual(branch, data["branch"])
        self.assertEqual([], data["candidates"])
        self.assertEqual(40, len(data["state_sha"]))
        self.assertTrue(run("git", "ls-remote", "--heads", "origin",
                            "refs/heads/chore/发布线状态记录", cwd=self.repo).stdout)

    def test_candidate_requires_authorized_switch_and_old_release_closeout(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old, with_commit=True)
        adopted = self.command("activate", "--branch", old, "--user-authorized", "--json")
        self.assertEqual(0, adopted.returncode, adopted.stderr)
        old_sha = json.loads(adopted.stdout)["state_sha"]
        task = self.root / "task-old"
        task_branch = "chore/IKITEST-旧发布线任务"
        run("git", "worktree", "add", "-b", task_branch, task, old, cwd=self.repo)
        task_start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
            "--target-branch", old, "--start-sha", task_start, "--user-authorized", cwd=task)
        self.release(new)
        blocked = self.command("current", "--json")
        self.assertNotEqual(0, blocked.returncode)
        self.assertIn("未经授权", blocked.stderr)
        no_snapshot = self.command("activate", "--branch", new, "--user-authorized")
        self.assertNotEqual(0, no_snapshot.returncode)
        self.assertIn("尚未进入 origin/master", no_snapshot.stderr)
        self.assertIn(task_branch, no_snapshot.stderr)
        self.assertIn("开放 PR：未核对", no_snapshot.stderr)
        run("git", "merge", "--no-ff", "--no-edit", old, cwd=self.repo)
        run("git", "push", "origin", "master", cwd=self.repo)
        no_snapshot = self.command("activate", "--branch", new, "--user-authorized")
        self.assertNotEqual(0, no_snapshot.returncode)
        self.assertIn("--pr-snapshot", no_snapshot.stderr)
        snapshot = self.snapshot([{"number": 42, "target_branch": old, "state": "opened"}])
        inventory = self.command("list", "--pr-snapshot", snapshot, "--json")
        self.assertEqual(0, inventory.returncode, inventory.stderr)
        self.assertEqual(42, json.loads(inventory.stdout)["open_prs"][0]["number"])
        self.assertEqual(old, next(item["target_branch"] for item in
                                    json.loads(inventory.stdout)["task_worktrees"]
                                    if item["branch"] == task_branch))
        open_pr = self.command("activate", "--branch", new, "--user-authorized",
                               "--pr-snapshot", snapshot)
        self.assertNotEqual(0, open_pr.returncode)
        self.assertIn("42", open_pr.stderr)
        self.assertIn(task_branch, open_pr.stderr)
        self.assertEqual(old_sha, json.loads(self.command("list", "--json").stdout)["state_sha"])
        snapshot = self.snapshot()
        unresolved_task = self.command("activate", "--branch", new, "--user-authorized",
                                       "--pr-snapshot", snapshot)
        self.assertNotEqual(0, unresolved_task.returncode)
        self.assertIn(task_branch, unresolved_task.stderr)
        self.assertIn("开放 PR：无", unresolved_task.stderr)
        run("git", "worktree", "remove", task, cwd=self.repo)
        run("git", "branch", "-d", task_branch, cwd=self.repo)
        changed = self.command("activate", "--branch", new, "--user-authorized",
                               "--pr-snapshot", snapshot, "--json")
        self.assertEqual(0, changed.returncode, changed.stderr)
        self.assertIn(old, json.loads(changed.stdout)["legacy"])
        self.assertEqual(new, json.loads(self.command("current", "--json").stdout)["branch"])
        self.assertTrue(run("git", "ls-remote", "--heads", "origin", old,
                            cwd=self.repo).stdout, "old release was deleted")

    def test_ambiguous_bootstrap_and_second_candidate_stop(self):
        first = "release/2026.09.24_旧版发布验证"
        second = "release/2026.09.29_新版发布验证"
        third = "release/2026.10.01_下期发布验证"
        self.release(first)
        self.release(second)
        rejected = self.command("activate", "--branch", second, "--user-authorized")
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("--adopt-legacy", rejected.stderr)
        self.assertNotEqual(0, self.command("current", "--json").returncode)
        missing_snapshot = self.command("activate", "--branch", second, "--adopt-legacy",
                                        "--user-authorized")
        self.assertNotEqual(0, missing_snapshot.returncode)
        self.assertIn("--pr-snapshot", missing_snapshot.stderr)
        open_pr_snapshot = self.snapshot([
            {"number": 58, "target_branch": first, "state": "opened"}
        ])
        open_pr = self.command("activate", "--branch", second, "--adopt-legacy",
                               "--user-authorized", "--pr-snapshot", open_pr_snapshot)
        self.assertNotEqual(0, open_pr.returncode)
        self.assertIn("!58", open_pr.stderr)
        self.assertIn(first, open_pr.stderr)
        self.assertNotEqual(0, self.command("current", "--json").returncode)
        adopted = self.command("activate", "--branch", second, "--adopt-legacy",
                               "--user-authorized", "--pr-snapshot", self.snapshot(),
                               "--json")
        self.assertEqual(0, adopted.returncode, adopted.stderr)
        self.assertEqual([first], json.loads(adopted.stdout)["legacy"])
        self.release(third)
        fourth = "release/2026.10.02_再下期发布验证"
        self.release(fourth)
        inventory = self.command("list", "--count", "1", "--json")
        self.assertEqual(0, inventory.returncode, inventory.stderr)
        listed = json.loads(inventory.stdout)
        self.assertEqual(1, len(listed["recent"]))
        self.assertEqual({third, fourth}, set(listed["candidates"]))
        refused = self.command("activate", "--branch", third, "--user-authorized",
                               "--pr-snapshot", self.snapshot())
        self.assertNotEqual(0, refused.returncode)
        self.assertIn("候选不唯一", refused.stderr)

    def test_create_rejects_second_active_line_and_offline_state(self):
        first = self.command("create", "--summary", "发布流程验证", "--user-authorized", "--json")
        self.assertEqual(0, first.returncode, first.stderr)
        second = self.command("create", "--summary", "另一批次验证", "--user-authorized")
        self.assertNotEqual(0, second.returncode)
        self.assertIn("--pr-snapshot", second.stderr)
        self.assertEqual(1, len(run("git", "ls-remote", "--heads", "origin",
                                    "release/*", cwd=self.repo).stdout.splitlines()))
        run("git", "remote", "set-url", "origin", self.root / "missing.git", cwd=self.repo)
        offline = self.command("current", "--json")
        self.assertNotEqual(0, offline.returncode)
        self.assertIn("远端不可达", offline.stderr)

    def test_create_rejects_second_line_with_old_tasks_and_pr_inventory(self):
        first = self.command("create", "--summary", "发布流程验证", "--user-authorized", "--json")
        self.assertEqual(0, first.returncode, first.stderr)
        old = json.loads(first.stdout)["branch"]
        task = self.root / "task-old"
        branch = "chore/IKITEST-旧任务"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
            "--target-branch", old, "--start-sha", start, "--user-authorized", cwd=task)
        snapshot = self.snapshot([{"number": 91, "target_branch": old, "state": "opened"}])
        rejected = self.command("create", "--summary", "下期发布验证", "--user-authorized",
                                "--pr-snapshot", snapshot)
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn(branch, rejected.stderr)
        self.assertIn("!91", rejected.stderr)
        self.assertEqual(1, len(run("git", "ls-remote", "--heads", "origin",
                                    "release/*", cwd=self.repo).stdout.splitlines()))

    def test_create_rejects_unattributed_legacy_task_worktree(self):
        first = self.command("create", "--summary", "发布流程验证", "--user-authorized", "--json")
        self.assertEqual(0, first.returncode, first.stderr)
        old = json.loads(first.stdout)["branch"]
        task = self.root / "task-without-metadata"
        branch = "chore/IKITEST-归属待核对"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        snapshot = self.snapshot()

        blocked = self.command("create", "--summary", "下期发布验证", "--user-authorized",
                               "--pr-snapshot", snapshot)
        self.assertNotEqual(0, blocked.returncode)
        self.assertIn("归属未核实任务", blocked.stderr)
        self.assertIn(branch, blocked.stderr)
        self.assertIn("开放 PR：无", blocked.stderr)
        self.assertEqual(1, len(run("git", "ls-remote", "--heads", "origin",
                                    "release/*", cwd=self.repo).stdout.splitlines()))

        run("git", "worktree", "remove", task, cwd=self.repo)
        run("git", "branch", "-d", branch, cwd=self.repo)
        created = self.command("create", "--summary", "下期发布验证", "--user-authorized",
                               "--pr-snapshot", snapshot, "--json")
        self.assertEqual(0, created.returncode, created.stderr)

    def test_create_after_closeout_retains_old_branch_and_uses_suffix(self):
        first = self.command("create", "--summary", "发布流程验证", "--user-authorized", "--json")
        self.assertEqual(0, first.returncode, first.stderr)
        old = json.loads(first.stdout)["branch"]
        second = self.command("create", "--summary", "发布流程验证", "--user-authorized",
                              "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, second.returncode, second.stderr)
        new = json.loads(second.stdout)["branch"]
        self.assertEqual(old + "_2", new)
        self.assertIn(old, json.loads(self.command("current", "--json").stdout)["legacy"])
        self.assertTrue(run("git", "ls-remote", "--heads", "origin", old,
                            cwd=self.repo).stdout)


if __name__ == "__main__":
    unittest.main()
