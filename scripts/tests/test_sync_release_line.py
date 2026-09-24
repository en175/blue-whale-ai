#!/usr/bin/env python3
"""Black-box synchronization tests using the release-line bare Git fixture."""

import json
import os
import subprocess
import sys
import unittest

try:
    from .bash_helper import BASH
    from .test_manage_release_branch import ReleaseLineFixture, run
except ImportError:
    from bash_helper import BASH
    from test_manage_release_branch import ReleaseLineFixture, run


class SyncReleaseLineTest(ReleaseLineFixture, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.branch = "release/2026.09.29_本地同步验证"
        self.release(self.branch)
        enabled = self.command("activate", "--branch", self.branch, "--user-authorized", "--json")
        self.assertEqual(0, enabled.returncode, enabled.stderr)
        run("git", "checkout", self.branch, cwd=self.repo)
        self.actor = self.root / "actor"
        run("git", "clone", self.bare, self.actor, cwd=self.root)
        run("git", "config", "user.name", "Remote Test", cwd=self.actor)
        run("git", "config", "user.email", "remote@example.com", cwd=self.actor)
        run("git", "checkout", self.branch, cwd=self.actor)

    def sync(self):
        return run(BASH, self.repo / "scripts/sync-release-line.sh", "--json",
                   cwd=self.repo, check=False)

    def head(self, repo=None):
        return run("git", "rev-parse", "HEAD", cwd=repo or self.repo).stdout.strip()

    def commit(self, repo, path, content):
        (repo / path).write_text(content, encoding="utf-8")
        run("git", "add", path, cwd=repo)
        run("git", "commit", "-m", f"test: {path}", cwd=repo)
        return self.head(repo)

    def remote_commit(self, path, content):
        sha = self.commit(self.actor, path, content)
        run("git", "push", "origin", self.branch, cwd=self.actor)
        return sha

    def test_same_and_local_ahead_keep_local_commit_and_report_index_directory(self):
        same = self.sync()
        self.assertEqual(0, same.returncode, same.stderr)
        data = json.loads(same.stdout)
        self.assertEqual("same", data["action"])
        self.assertEqual(self.branch, data["branch"])
        self.assertEqual(str(self.repo.resolve()), data["cbm_root_path"])
        self.assertTrue(data["cbm_check_required"])
        local = self.commit(self.repo, "local.txt", "local\n")
        (self.repo / "notes.txt").write_text("uncommitted\n", encoding="utf-8")
        ahead = self.sync()
        self.assertEqual(0, ahead.returncode, ahead.stderr)
        data = json.loads(ahead.stdout)
        self.assertEqual("local_ahead", data["action"])
        self.assertEqual(local, data["sha"])
        self.assertTrue(any("notes.txt" in path for path in data["dirty_paths"]))
        self.assertEqual("uncommitted\n", (self.repo / "notes.txt").read_text(encoding="utf-8"))

    def test_remote_ahead_fast_forwards(self):
        remote = self.remote_commit("remote.txt", "remote\n")
        result = self.sync()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("fast_forward", json.loads(result.stdout)["action"])
        self.assertEqual(remote, self.head())
        self.assertEqual("remote\n", (self.repo / "remote.txt").read_text(encoding="utf-8"))

    def test_diverged_histories_merge_and_keep_unrelated_dirty_file(self):
        local = self.commit(self.repo, "local.txt", "local\n")
        (self.repo / "notes.txt").write_text("draft\n", encoding="utf-8")
        remote = self.remote_commit("remote.txt", "remote\n")
        result = self.sync()
        self.assertEqual(0, result.returncode, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual("merged", data["action"])
        self.assertEqual(0, run("git", "merge-base", "--is-ancestor", local, data["sha"], cwd=self.repo).returncode)
        self.assertEqual(0, run("git", "merge-base", "--is-ancestor", remote, data["sha"], cwd=self.repo).returncode)
        self.assertEqual("draft\n", (self.repo / "notes.txt").read_text(encoding="utf-8"))

    def test_conflict_aborts_and_preserves_original_commit_and_dirty_file(self):
        local = self.commit(self.repo, "base.txt", "local\n")
        (self.repo / "notes.txt").write_text("draft\n", encoding="utf-8")
        self.remote_commit("base.txt", "remote\n")
        result = self.sync()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("已自动 abort", result.stderr)
        self.assertEqual(local, self.head())
        self.assertEqual("local\n", (self.repo / "base.txt").read_text(encoding="utf-8"))
        self.assertEqual("draft\n", (self.repo / "notes.txt").read_text(encoding="utf-8"))
        self.assertFalse(run("git", "rev-parse", "--verify", "MERGE_HEAD", cwd=self.repo, check=False).returncode == 0)

    def test_dirty_path_that_remote_changes_stops_without_loss(self):
        before = self.head()
        (self.repo / "base.txt").write_text("draft\n", encoding="utf-8")
        self.remote_commit("base.txt", "remote\n")
        result = self.sync()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("同步停止", result.stderr)
        self.assertEqual(before, self.head())
        self.assertEqual("draft\n", (self.repo / "base.txt").read_text(encoding="utf-8"))

    def test_untracked_path_that_remote_adds_stops_without_loss(self):
        before = self.head()
        (self.repo / "incoming.txt").write_text("draft\n", encoding="utf-8")
        self.remote_commit("incoming.txt", "remote\n")
        result = self.sync()
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(before, self.head())
        self.assertEqual("draft\n", (self.repo / "incoming.txt").read_text(encoding="utf-8"))

    def test_offline_stops_without_claiming_freshness(self):
        before = self.head()
        (self.repo / "notes.txt").write_text("draft\n", encoding="utf-8")
        run("git", "remote", "set-url", "origin", self.root / "missing.git", cwd=self.repo)
        result = self.sync()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("远端不可达", result.stderr)
        self.assertNotIn("已是最新", result.stderr)
        self.assertEqual(before, self.head())
        self.assertEqual("draft\n", (self.repo / "notes.txt").read_text(encoding="utf-8"))

    def test_python_entry_uses_shared_release_state_without_bash(self):
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        if os.name != "nt":
            fake_bash = fake_bin / "bash"
            fake_bash.write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
            fake_bash.chmod(0o755)
        environment = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}"}
        result = subprocess.run(
            [sys.executable, self.repo / "scripts/sync-release-line.py", "--json"],
            cwd=self.repo, env=environment, text=True, encoding="utf-8",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(self.branch, json.loads(result.stdout)["branch"])

    def test_sync_rejects_unapproved_candidate_like_release_manager(self):
        candidate = "release/2026.10.01_下期同步验证"
        run("git", "branch", candidate, cwd=self.repo)
        run("git", "push", "origin", candidate, cwd=self.repo)
        result = self.sync()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("未经授权", result.stderr)

    def test_two_concurrent_syncs_finish_at_same_commit(self):
        local = self.commit(self.repo, "local.txt", "local\n")
        remote = self.remote_commit("remote.txt", "remote\n")
        hooks = self.repo / ".git" / "hooks"
        delay = 11 if os.name == "nt" else 1
        (hooks / "pre-merge-commit").write_text(f"#!/bin/sh\nsleep {delay}\n", encoding="utf-8")
        (hooks / "pre-merge-commit").chmod(0o755)
        argv = [BASH, str(self.repo / "scripts/sync-release-line.sh"), "--json"]
        first = subprocess.Popen(argv, cwd=self.repo, text=True, encoding="utf-8",
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        second = subprocess.Popen(argv, cwd=self.repo, text=True, encoding="utf-8",
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        first_out, first_err = first.communicate(timeout=30)
        second_out, second_err = second.communicate(timeout=30)
        self.assertEqual(0, first.returncode, first_err)
        self.assertEqual(0, second.returncode, second_err)
        first_sha = json.loads(first_out)["sha"]
        self.assertEqual(first_sha, json.loads(second_out)["sha"])
        self.assertEqual(first_sha, self.head())
        self.assertEqual(0, run("git", "merge-base", "--is-ancestor", local, first_sha, cwd=self.repo).returncode)
        self.assertEqual(0, run("git", "merge-base", "--is-ancestor", remote, first_sha, cwd=self.repo).returncode)

    def test_requires_checkout_of_active_release(self):
        run("git", "checkout", "master", cwd=self.repo)
        result = self.sync()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("活动发布线", result.stderr)


if __name__ == "__main__":
    unittest.main()
