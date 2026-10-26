#!/usr/bin/env python3

import datetime as dt
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.lib.release_line_sync import release_line_lock

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
        (self.repo / ".gitignore").write_text("__pycache__/\n*.pyc\n", encoding="utf-8")
        hooks = self.repo / ".githooks"
        hooks.mkdir()
        (hooks / "pre-push").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        (hooks / "pre-push").chmod(0o755)
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

    def activate_earlier_release(self):
        branch = f"release/{dt.date.today() - dt.timedelta(days=14):%Y.%m.%d}_旧版发布验证"
        self.release(branch)
        activated = self.command("activate", "--branch", branch, "--user-authorized")
        if activated.returncode:
            raise AssertionError(activated.stderr)
        return branch

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
        run("git", "commit", "--allow-empty", "-m", "chore: pending old task", cwd=task)
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
        run("git", "branch", "-D", task_branch, cwd=self.repo)
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

    def test_older_branch_is_history_and_newer_branch_still_needs_activation(self):
        active = "release/2026.09.29_当前发布验证"
        older = "release/2026.09.15_历史发布验证"
        newer = "release/2026.10.13_下期发布验证"
        self.release(active)
        adopted = self.command("activate", "--branch", active, "--user-authorized", "--json")
        self.assertEqual(0, adopted.returncode, adopted.stderr)
        self.release(older)

        current = self.command("current", "--json")
        self.assertEqual(0, current.returncode, current.stderr)
        self.assertEqual([], json.loads(current.stdout)["candidates"])
        self.assertIn(older, json.loads(current.stdout)["legacy"])

        self.release(newer)
        blocked = self.command("current", "--json")
        self.assertNotEqual(0, blocked.returncode)
        self.assertIn(newer, blocked.stderr)
        activated = self.command("activate", "--branch", newer, "--user-authorized",
                                 "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, activated.returncode, activated.stderr)
        self.assertEqual({older, active}, set(json.loads(activated.stdout)["legacy"]))

    def test_uncomparable_branch_requires_owner_classification(self):
        active = "release/2026.09.29_当前发布验证"
        same_day = "release/2026.09.29_另一个发布验证"
        undated = "release/prod"
        self.release(active)
        self.assertEqual(0, self.command("activate", "--branch", active,
                                         "--user-authorized").returncode)
        self.release(same_day)
        self.release(undated)

        blocked = self.command("current", "--json")
        self.assertNotEqual(0, blocked.returncode)
        listing = self.command("list", "--json")
        self.assertEqual(0, listing.returncode, listing.stderr)
        self.assertEqual({same_day, undated},
                         set(json.loads(listing.stdout)["unclassified"]))

        classified = self.command("activate", "--branch", active, "--adopt-legacy",
                                  "--user-authorized", "--json")
        self.assertEqual(0, classified.returncode, classified.stderr)
        self.assertEqual({same_day, undated}, set(json.loads(classified.stdout)["legacy"]))
        self.assertEqual(0, self.command("current", "--json").returncode)

    def test_owner_can_activate_same_day_branch_after_closeout(self):
        active = "release/2026.09.29_当前发布验证"
        replacement = "release/2026.09.29_同日接任验证"
        self.release(active)
        self.assertEqual(0, self.command("activate", "--branch", active,
                                         "--user-authorized").returncode)
        self.release(replacement)

        rejected = self.command("activate", "--branch", replacement,
                                "--user-authorized", "--pr-snapshot", self.snapshot())
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("无法按日期归类", rejected.stderr)
        switched = self.command("activate", "--branch", replacement, "--adopt-legacy",
                                "--user-authorized", "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, switched.returncode, switched.stderr)
        self.assertEqual(active, json.loads(switched.stdout)["legacy"][0])
        self.assertEqual(replacement, json.loads(self.command("current", "--json").stdout)["branch"])

    def test_first_activation_rejects_older_target_without_bootstrap(self):
        older = "release/2026.09.15_历史发布验证"
        newer = "release/2026.09.29_当前发布验证"
        self.release(older)
        self.release(newer)

        rejected = self.command("activate", "--branch", older, "--adopt-legacy",
                                "--user-authorized", "--pr-snapshot", self.snapshot())
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("日期最新", rejected.stderr)

    def test_first_activation_requires_names_for_ambiguous_history(self):
        active = "release/2026.09.29_当前发布验证"
        same_day = "release/2026.09.29_同日发布验证"
        undated = "release/prod"
        for branch in (active, same_day, undated):
            self.release(branch)
        listed = self.command("list", "--json")
        self.assertEqual(0, listed.returncode, listed.stderr)
        self.assertEqual({active, same_day, undated},
                         set(json.loads(listed.stdout)["unclassified"]))

        rejected = self.command("activate", "--branch", active, "--adopt-legacy",
                                "--user-authorized", "--pr-snapshot", self.snapshot())
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn(same_day, rejected.stderr)
        self.assertIn(undated, rejected.stderr)
        self.assertFalse(run("git", "ls-remote", "--heads", "origin",
                             "refs/heads/chore/发布线状态记录", cwd=self.repo).stdout)

        adopted = self.command("activate", "--branch", active, "--adopt-legacy",
                               "--classify-legacy", same_day, "--classify-legacy", undated,
                               "--user-authorized", "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, adopted.returncode, adopted.stderr)
        self.assertEqual({same_day, undated}, set(json.loads(adopted.stdout)["legacy"]))

    def test_clean_merged_task_worktree_does_not_block_switch(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.assertEqual(0, self.command("activate", "--branch", old,
                                         "--user-authorized").returncode)
        task = self.root / "merged-task-worktree"
        branch = "chore/IKITEST-已合入工作树"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
            "--target-branch", old, "--start-sha", start, "--user-authorized", cwd=task)
        run("git", "commit", "--allow-empty", "-m", "chore: delivered task", cwd=task)
        run("git", "switch", old, cwd=self.repo)
        run("git", "merge", "--no-ff", "--no-edit", branch, cwd=self.repo)
        run("git", "push", "origin", old, cwd=self.repo)
        run("git", "switch", "master", cwd=self.repo)
        run("git", "merge", "--no-ff", "--no-edit", old, cwd=self.repo)
        run("git", "push", "origin", "master", cwd=self.repo)
        self.release(new)

        switched = self.command("activate", "--branch", new, "--user-authorized",
                                "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, switched.returncode, switched.stderr)
        self.assertTrue(task.exists())

    def test_historical_task_worktree_does_not_block_next_switch(self):
        historical = "release/2026.09.15_历史发布验证"
        active = "release/2026.09.29_当前发布验证"
        newer = "release/2026.10.13_下期发布验证"
        self.release(historical)
        self.release(active)
        adopted = self.command("activate", "--branch", active, "--adopt-legacy",
                               "--user-authorized", "--pr-snapshot", self.snapshot())
        self.assertEqual(0, adopted.returncode, adopted.stderr)
        task = self.root / "historical-task"
        branch = "chore/IKITEST-历史任务"
        run("git", "worktree", "add", "-b", branch, task, historical, cwd=self.repo)
        start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
            "--target-branch", historical, "--start-sha", start, "--user-authorized", cwd=task)
        run("git", "commit", "--allow-empty", "-m", "chore: historical follow-up", cwd=task)
        self.release(newer)

        switched = self.command("activate", "--branch", newer, "--user-authorized",
                                "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, switched.returncode, switched.stderr)
        self.assertTrue(task.exists())

    def test_initial_adoption_rejects_legacy_task_worktree(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        task = self.root / "legacy-task"
        branch = "chore/IKITEST-旧发布线任务"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
            "--target-branch", old, "--start-sha", start, "--user-authorized", cwd=task)
        run("git", "commit", "--allow-empty", "-m", "chore: pending legacy task", cwd=task)

        rejected = self.command("activate", "--branch", new, "--adopt-legacy",
                                "--user-authorized", "--pr-snapshot", self.snapshot())

        self.assertNotEqual(0, rejected.returncode)
        self.assertIn(branch, rejected.stderr)
        self.assertFalse(run("git", "ls-remote", "--heads", "origin",
                             "refs/heads/chore/发布线状态记录", cwd=self.repo).stdout)

    def test_initial_adoption_rejects_unchecked_task_branch_without_worktree(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        task = self.root / "orphan-task"
        branch = "chore/IKITEST-遗留未合任务"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: unmerged task", cwd=task)
        run("git", "worktree", "remove", task, cwd=self.repo)

        rejected = self.command("activate", "--branch", new, "--adopt-legacy",
                                "--user-authorized", "--pr-snapshot", self.snapshot())

        self.assertNotEqual(0, rejected.returncode)
        self.assertIn(branch, rejected.stderr)
        self.assertFalse(run("git", "ls-remote", "--heads", "origin",
                             "refs/heads/chore/发布线状态记录", cwd=self.repo).stdout)

    def test_bootstrap_existing_preserves_legacy_tasks_branches_and_prs(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        task = self.root / "legacy-task"
        task_branch = "chore/IKITEST-旧发布线任务"
        run("git", "worktree", "add", "-b", task_branch, task, old, cwd=self.repo)
        start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
            "--target-branch", old, "--start-sha", start, "--user-authorized", cwd=task)
        run("git", "commit", "--allow-empty", "-m", "chore: pending legacy task", cwd=task)
        orphan = "chore/IKITEST-遗留未合任务"
        run("git", "branch", orphan, old, cwd=self.repo)
        run("git", "worktree", "add", self.root / "orphan", orphan, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: pending legacy work",
            cwd=self.root / "orphan")
        run("git", "worktree", "remove", self.root / "orphan", cwd=self.repo)
        bootstrap = self.root / "bootstrap"
        run("git", "worktree", "add", "-b", "chore/IKITEST-首次接管", bootstrap,
            new, cwd=self.repo)
        snapshot = self.snapshot([{"number": 58, "target_branch": old, "state": "opened"}])

        activated = run(BASH, bootstrap / "scripts/manage-release-branch.sh", "activate",
                        "--branch", new, "--adopt-legacy", "--bootstrap-existing",
                        "--user-authorized", "--pr-snapshot", snapshot, "--json",
                        cwd=bootstrap, check=False)

        self.assertEqual(0, activated.returncode, activated.stderr)
        data = json.loads(activated.stdout)
        self.assertEqual(new, data["branch"])
        self.assertEqual([old], data["legacy"])
        self.assertEqual(task_branch, data["legacy_inventory"]["task_worktrees"][0]["branch"])
        self.assertIn(orphan, data["legacy_inventory"]["unmerged_task_branches"])
        self.assertEqual(58, data["legacy_inventory"]["open_prs"][0]["number"])
        self.assertTrue(task.exists())
        self.assertTrue(run("git", "show-ref", "--verify", f"refs/heads/{orphan}",
                            cwd=self.repo).stdout)
        self.assertEqual(new, json.loads(self.command("current", "--json").stdout)["branch"])

    def test_bootstrap_existing_records_unshared_legacy_release_work(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        old_worktree = self.root / "old-release"
        run("git", "worktree", "add", old_worktree, old, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: local legacy commit",
            cwd=old_worktree)
        bootstrap = self.root / "bootstrap"
        run("git", "worktree", "add", "-b", "chore/IKITEST-首次接管", bootstrap,
            new, cwd=self.repo)

        activated = run(BASH, bootstrap / "scripts/manage-release-branch.sh", "activate",
                        "--branch", new, "--adopt-legacy", "--bootstrap-existing",
                        "--user-authorized", "--pr-snapshot", self.snapshot(), "--json",
                        cwd=bootstrap, check=False)

        self.assertEqual(0, activated.returncode, activated.stderr)
        item = json.loads(activated.stdout)["legacy_inventory"]["release_branches"][0]
        self.assertEqual(old, item["branch"])
        self.assertTrue(item["remote_exists"])
        self.assertEqual(1, item["local_commit_count"])
        self.assertTrue(run("git", "show-ref", "--verify", f"refs/heads/{old}",
                            cwd=self.repo).stdout)

    def test_bootstrap_existing_preserves_local_only_archived_release_with_unsaved_file(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        old_worktree = self.root / "old-release"
        run("git", "worktree", "add", old_worktree, old, cwd=self.repo)
        (old_worktree / "draft.txt").write_text("keep me\n", encoding="utf-8")
        run("git", "push", "origin", "--delete", old, cwd=self.repo)
        bootstrap = self.root / "bootstrap"
        run("git", "worktree", "add", "-b", "chore/IKITEST-首次接管", bootstrap,
            new, cwd=self.repo)

        activated = run(BASH, bootstrap / "scripts/manage-release-branch.sh", "activate",
                        "--branch", new, "--adopt-legacy", "--bootstrap-existing",
                        "--user-authorized", "--pr-snapshot", self.snapshot(), "--json",
                        cwd=bootstrap, check=False)

        self.assertEqual(0, activated.returncode, activated.stderr)
        data = json.loads(activated.stdout)
        self.assertIn(old, data["legacy"])
        item = data["legacy_inventory"]["release_branches"][0]
        self.assertFalse(item["remote_exists"])
        self.assertIn("draft.txt", item["worktree_changes"][0]["status"])
        self.assertEqual("keep me\n", (old_worktree / "draft.txt").read_text(encoding="utf-8"))
        self.assertEqual(new, json.loads(self.command("current", "--json").stdout)["branch"])

    def test_bootstrap_existing_does_not_count_commit_shared_by_another_release(self):
        old = "release/2026.09.15_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        old_worktree = self.root / "old-release"
        run("git", "worktree", "add", old_worktree, old, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: shared history",
            cwd=old_worktree)
        run("git", "push", "origin", f"{old}:{new}", cwd=self.repo)
        run("git", "push", "origin", "--delete", old, cwd=self.repo)
        bootstrap = self.root / "bootstrap"
        run("git", "worktree", "add", "-b", "chore/IKITEST-首次接管", bootstrap,
            new, cwd=self.repo)

        activated = run(BASH, bootstrap / "scripts/manage-release-branch.sh", "activate",
                        "--branch", new, "--adopt-legacy", "--bootstrap-existing",
                        "--user-authorized", "--pr-snapshot", self.snapshot(), "--json",
                        cwd=bootstrap, check=False)

        self.assertEqual(0, activated.returncode, activated.stderr)
        item = json.loads(activated.stdout)["legacy_inventory"]["release_branches"][0]
        self.assertFalse(item["remote_exists"])
        self.assertEqual(0, item["local_commit_count"])
        self.assertEqual(1, int(run("git", "rev-list", "--count", "origin/master.." + old,
                                    cwd=self.repo).stdout.strip()))

    def test_bootstrap_existing_requires_latest_dated_release(self):
        old = "release/2026.09.24_旧版发布验证"
        new = "release/2026.09.29_新版发布验证"
        self.release(old)
        self.release(new)
        bootstrap = self.root / "bootstrap"
        run("git", "worktree", "add", "-b", "chore/IKITEST-首次接管", bootstrap,
            old, cwd=self.repo)

        rejected = run(BASH, bootstrap / "scripts/manage-release-branch.sh", "activate",
                       "--branch", old, "--adopt-legacy", "--bootstrap-existing",
                       "--user-authorized", "--pr-snapshot", self.snapshot(),
                       cwd=bootstrap, check=False)

        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("日期最新", rejected.stderr)

    def test_bootstrap_existing_requires_isolated_task_worktree(self):
        target = "release/2026.09.29_新版发布验证"
        self.release(target)
        args = ("activate", "--branch", target, "--bootstrap-existing",
                "--user-authorized", "--pr-snapshot", self.snapshot())

        main = self.command(*args)
        self.assertNotEqual(0, main.returncode)
        self.assertIn("隔离任务工作树", main.stderr)
        release_worktree = self.root / "release"
        run("git", "worktree", "add", release_worktree, target, cwd=self.repo)
        direct = run(BASH, release_worktree / "scripts/manage-release-branch.sh", *args,
                     cwd=release_worktree, check=False)
        self.assertNotEqual(0, direct.returncode)
        self.assertIn("隔离任务工作树", direct.stderr)
        self.assertFalse(run("git", "ls-remote", "--heads", "origin",
                             "refs/heads/chore/发布线状态记录", cwd=self.repo).stdout)

    def test_create_rejects_unchecked_task_branch_without_worktree(self):
        first = self.command("create", "--summary", "旧版发布验证", "--user-authorized", "--json")
        self.assertEqual(0, first.returncode, first.stderr)
        old = json.loads(first.stdout)["branch"]
        task = self.root / "orphan-task"
        branch = "chore/IKITEST-遗留未合任务"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: unmerged task", cwd=task)
        run("git", "worktree", "remove", task, cwd=self.repo)

        rejected = self.command("create", "--summary", "新版发布验证",
                                "--user-authorized", "--pr-snapshot", self.snapshot())

        self.assertNotEqual(0, rejected.returncode)
        self.assertIn(branch, rejected.stderr)
        self.assertEqual(old, json.loads(self.command("current", "--json").stdout)["branch"])
        inventory = json.loads(self.command("list", "--json").stdout)
        self.assertIn(branch, inventory["unmerged_task_branches"])

    def test_create_allows_retained_task_branch_already_merged_to_release(self):
        old = self.activate_earlier_release()
        task = self.root / "merged-task"
        branch = "chore/IKITEST-已合入任务"
        run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: merged task", cwd=task)
        run("git", "worktree", "remove", task, cwd=self.repo)
        run("git", "switch", old, cwd=self.repo)
        run("git", "merge", "--no-ff", "--no-edit", branch, cwd=self.repo)
        run("git", "push", "origin", old, cwd=self.repo)
        run("git", "switch", "master", cwd=self.repo)
        run("git", "merge", "--no-ff", "--no-edit", old, cwd=self.repo)
        run("git", "push", "origin", "master", cwd=self.repo)

        created = self.command("create", "--summary", "新版发布验证",
                               "--user-authorized", "--pr-snapshot", self.snapshot(), "--json")

        self.assertEqual(0, created.returncode, created.stderr)
        self.assertEqual(branch, run("git", "branch", "--list", branch,
                                     cwd=self.repo).stdout.strip().lstrip("* "))

    def test_switch_rejects_unshared_local_release_commit_and_dirty_file(self):
        created = self.command("create", "--summary", "旧版发布验证", "--user-authorized", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        old = json.loads(created.stdout)["branch"]
        new = f"release/{dt.date.today() + dt.timedelta(days=14):%Y.%m.%d}_新版发布验证"
        self.release(new)
        old_worktree = self.root / "old-release"
        run("git", "worktree", "add", old_worktree, old, cwd=self.repo)
        run("git", "commit", "--allow-empty", "-m", "chore: local release work", cwd=old_worktree)
        (old_worktree / "draft.txt").write_text("unsaved\n", encoding="utf-8")

        rejected = self.command("activate", "--branch", new, "--user-authorized",
                                "--pr-snapshot", self.snapshot())

        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("local release work", rejected.stderr)
        self.assertIn("draft.txt", rejected.stderr)
        self.assertEqual(old, json.loads(self.command("list", "--json").stdout)["branch"])
        self.assertEqual("unsaved\n", (old_worktree / "draft.txt").read_text(encoding="utf-8"))

    def test_switch_rejects_dirty_release_worktree_without_local_commits(self):
        created = self.command("create", "--summary", "旧版发布验证", "--user-authorized", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        old = json.loads(created.stdout)["branch"]
        new = f"release/{dt.date.today() + dt.timedelta(days=14):%Y.%m.%d}_新版发布验证"
        self.release(new)
        old_worktree = self.root / "old-release"
        run("git", "worktree", "add", old_worktree, old, cwd=self.repo)
        (old_worktree / "draft.txt").write_text("unsaved\n", encoding="utf-8")

        rejected = self.command("activate", "--branch", new, "--user-authorized",
                                "--pr-snapshot", self.snapshot())

        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("draft.txt", rejected.stderr)
        self.assertEqual(old, json.loads(self.command("list", "--json").stdout)["branch"])

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
        run("git", "commit", "--allow-empty", "-m", "chore: pending old task", cwd=task)
        snapshot = self.snapshot([{"number": 91, "target_branch": old, "state": "opened"}])
        rejected = self.command("create", "--summary", "下期发布验证", "--user-authorized",
                                "--pr-snapshot", snapshot)
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn(branch, rejected.stderr)
        self.assertIn("!91", rejected.stderr)
        self.assertEqual(1, len(run("git", "ls-remote", "--heads", "origin",
                                    "release/*", cwd=self.repo).stdout.splitlines()))

    def test_create_rejects_unattributed_legacy_task_worktree(self):
        old = self.activate_earlier_release()
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

    def test_create_waits_for_task_creation_before_switching_line(self):
        old = self.activate_earlier_release()
        snapshot = self.snapshot()
        with release_line_lock(self.repo):
            process = subprocess.Popen(
                [BASH, str(self.repo / "scripts/manage-release-branch.sh"), "create",
                 "--summary", "新版发布验证", "--user-authorized", "--pr-snapshot", str(snapshot)],
                cwd=self.repo, text=True, encoding="utf-8", errors="replace",
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            try:
                process.communicate(timeout=1)
                waited = False
            except subprocess.TimeoutExpired:
                waited = True
                task = self.root / "task-in-progress"
                branch = "chore/IKITEST-并发开工任务"
                run("git", "worktree", "add", "-b", branch, task, old, cwd=self.repo)
                start = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
                run("python3", task / "scripts/lib/task_metadata.py", "repair", "--worktree", task,
                    "--target-branch", old, "--start-sha", start, "--user-authorized", cwd=task)
                run("git", "commit", "--allow-empty", "-m", "chore: task started during switch", cwd=task)
        _, stderr = process.communicate(timeout=15)

        self.assertTrue(waited, "换期入口未等待正在创建任务的发布线锁")
        self.assertNotEqual(0, process.returncode)
        self.assertIn(branch, stderr)
        self.assertEqual(old, json.loads(self.command("list", "--json").stdout)["branch"])

    def test_create_after_closeout_retains_old_branch_and_rejects_same_day_duplicate(self):
        old = self.activate_earlier_release()
        second = self.command("create", "--summary", "发布流程验证", "--user-authorized",
                              "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, second.returncode, second.stderr)
        new = json.loads(second.stdout)["branch"]
        self.assertNotEqual(old, new)
        self.assertIn(old, json.loads(self.command("current", "--json").stdout)["legacy"])
        self.assertTrue(run("git", "ls-remote", "--heads", "origin", old,
                            cwd=self.repo).stdout)
        duplicate = self.command("create", "--summary", "另一批次验证", "--user-authorized",
                                 "--pr-snapshot", self.snapshot())
        self.assertNotEqual(0, duplicate.returncode)
        self.assertIn("日期须晚于当前发布线", duplicate.stderr)


    def test_environment_branch_activates_and_keeps_environment_candidates(self):
        for name in ("dev", "test", "release"):
            self.release(name)
        listed = self.command("list", "--json")
        self.assertEqual(0, listed.returncode, listed.stderr)
        self.assertEqual({"dev", "test", "release"}, set(json.loads(listed.stdout)["unclassified"]))
        switched = self.command("activate", "--branch", "release", "--user-authorized",
                                "--adopt-legacy", "--pr-snapshot", self.snapshot(), "--json")
        self.assertEqual(0, switched.returncode, switched.stderr)
        data = json.loads(switched.stdout)
        self.assertEqual("release", data["branch"])
        self.assertEqual({"dev", "test"}, set(data["legacy"]))
        current = json.loads(self.command("current", "--json").stdout)
        self.assertEqual("release", current["branch"])
        self.assertEqual({"dev", "test"}, set(current["legacy"]))


if __name__ == "__main__":
    unittest.main()
