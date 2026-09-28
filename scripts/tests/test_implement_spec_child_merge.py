#!/usr/bin/env python3
"""Exercise implement-spec child integration with real Git worktrees."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "merge-implement-spec-child.py"
CLEANUP_SCRIPT = Path(__file__).resolve().parents[1] / "cleanup-implement-spec-child.py"
INTEGRATION = "docs/IKIOS6-整包集成验证"
CHILD_ONE = "fix/IKIOS6-第一子任务验证"
CHILD_TWO = "fix/IKIOS6-第二子任务验证"


def run(*args: str | Path, cwd: Path, check: bool = True, env=None):
    result = subprocess.run(
        [str(arg) for arg in args], cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", env=env,
    )
    if check and result.returncode:
        raise AssertionError(f"{args}\n{result.stdout}\n{result.stderr}")
    return result


class ImplementSpecChildMergeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin = self.root / "origin.git"
        self.main = self.root / "main"
        self.integration = self.root / "blue-whale-worktrees" / "integration"
        self.child_one = self.root / "blue-whale-worktrees" / "one"
        self.child_two = self.root / "blue-whale-worktrees" / "two"
        run("git", "init", "--bare", self.origin, cwd=self.root)
        run("git", "init", self.main, cwd=self.root)
        run("git", "config", "user.name", "Workflow Test", cwd=self.main)
        run("git", "config", "user.email", "workflow@example.com", cwd=self.main)
        run("git", "config", "commit.gpgsign", "false", cwd=self.main)
        (self.main / "shared.txt").write_text("base\n", encoding="utf-8")
        run("git", "add", ".", cwd=self.main)
        run("git", "commit", "-m", "chore: base", cwd=self.main)
        run("git", "remote", "add", "origin", self.origin, cwd=self.main)
        run("git", "branch", "release/test", cwd=self.main)
        run("git", "push", "origin", "release/test", cwd=self.main)
        self.base = self.git(self.main, "rev-parse", "HEAD")
        self.integration.parent.mkdir()
        for branch, path in ((INTEGRATION, self.integration),
                             (CHILD_ONE, self.child_one), (CHILD_TWO, self.child_two)):
            run("git", "worktree", "add", "-b", branch, path, "release/test", cwd=self.main)
            self.metadata(path, branch)

    def git(self, path, *args):
        return run("git", "-C", path, *args, cwd=self.root).stdout.strip()

    def metadata(self, path, branch):
        git_dir = Path(self.git(path, "rev-parse", "--absolute-git-dir"))
        target = git_dir / "blue-whale" / "task-base.json"
        target.parent.mkdir()
        target.write_text(json.dumps({"version": 1, "task_branch": branch,
                                      "target_branch": "release/test", "start_sha": self.base}),
                          encoding="utf-8")

    def commit(self, path, name, content):
        (path / name).write_text(content, encoding="utf-8")
        self.git(path, "add", name)
        self.git(path, "commit", "-m", f"fix: {name}")
        return self.git(path, "rev-parse", "HEAD")

    def invoke(self, child, env=None):
        return run(sys.executable, SCRIPT, "--child-worktree", child, "--json",
                   cwd=self.integration, check=False, env=env)

    def snapshot(self, source_head):
        path = self.root / "pr-snapshot.json"
        path.write_text(json.dumps({"pull_request_id": 91, "state": "opened",
                                    "source_branch": INTEGRATION,
                                    "target_branch": "release/test", "head_sha": source_head,
                                    "conflict": False, "changed_files": [],
                                    "fetched_at": int(time.time())}), encoding="utf-8")
        path.chmod(0o600)
        return path

    def cleanup(self, snapshot, env=None):
        return run(sys.executable, CLEANUP_SCRIPT, "--pr-snapshot", snapshot, "--json",
                   cwd=self.child_one, check=False, env=env)

    def merged_release_start(self):
        self.git(self.main, "switch", "-c", "release-side")
        self.commit(self.main, "side.txt", "side\n")
        self.git(self.main, "switch", "release/test")
        self.commit(self.main, "release.txt", "release\n")
        self.git(self.main, "merge", "--no-ff", "--no-edit", "-m",
                 "chore: merge release baseline", "release-side")
        self.base = self.git(self.main, "rev-parse", "HEAD")
        self.git(self.main, "push", "origin", "release/test")
        for worktree in (self.integration, self.child_one):
            self.git(worktree, "merge", "--ff-only", self.base)
            git_dir = Path(self.git(worktree, "rev-parse", "--absolute-git-dir"))
            metadata_path = git_dir / "blue-whale" / "task-base.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["start_sha"] = self.base
            if worktree == self.child_one:
                metadata["inherited_sha"] = self.base
                (metadata_path.parent / "task-integration-sha").write_text(
                    self.base + "\n", encoding="utf-8"
                )
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

    def synced_inherited_child_with_added_file(self, release_shared=False, child_shared=False):
        parent = self.commit(self.integration, "validation.md", "parent\n")
        self.git(self.main, "switch", "release/test")
        release = self.commit(self.main, "shared.txt" if release_shared else "release.txt",
                              "release\n")
        self.git(self.main, "push", "origin", "release/test")
        self.git(self.child_one, "merge", "--ff-only", release)
        self.git(self.child_one, "merge", "--no-ff", "--no-edit", "-m",
                 "chore: 继承整包父整合提交", parent)
        inherited = self.git(self.child_one, "rev-parse", "HEAD")
        metadata_path = Path(self.git(self.child_one, "rev-parse", "--absolute-git-dir")) / "blue-whale" / "task-base.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["start_sha"] = release
        metadata["inherited_sha"] = inherited
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        (metadata_path.parent / "task-integration-sha").write_text(inherited + "\n", encoding="utf-8")
        self.commit(self.child_one, "validation.md", "parent\nchild\n")
        if child_shared:
            self.commit(self.child_one, "shared.txt", "child\n")
        self.git(self.integration, "rebase", release)

    def test_two_children_from_different_integration_commits_fast_forward_with_correct_tree(self):
        self.commit(self.integration, "integration.txt", "integration\n")
        self.commit(self.child_one, "one.txt", "one\n")
        self.commit(self.child_two, "two.txt", "two\n")
        first = self.invoke(self.child_one)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        first_head = self.git(self.integration, "rev-parse", "HEAD")
        second = self.invoke(self.child_two)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertNotEqual(first_head, self.git(self.integration, "rev-parse", "HEAD"))
        self.assertEqual(self.git(self.integration, "rev-list", "--merges", f"{self.base}..HEAD"), "")
        self.assertEqual((self.integration / "one.txt").read_text(), "one\n")
        self.assertEqual((self.integration / "two.txt").read_text(), "two\n")
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"),
                         self.git(self.child_two, "rev-parse", "HEAD"))

    def test_inherited_children_merge_and_cleanup_without_losing_parent_content(self):
        parent = self.commit(self.integration, "integration.txt", "integration\n")
        for child in (self.child_one, self.child_two):
            self.git(child, "merge", "--no-ff", "--no-edit", "-m",
                     "chore: 继承整包父整合提交", parent)
            inherited = self.git(child, "rev-parse", "HEAD")
            git_dir = Path(self.git(child, "rev-parse", "--absolute-git-dir"))
            metadata_path = git_dir / "blue-whale" / "task-base.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            metadata["inherited_sha"] = inherited
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            (metadata_path.parent / "task-integration-sha").write_text(
                inherited + "\n", encoding="utf-8"
            )

        self.commit(self.child_one, "one.txt", "one\n")
        self.commit(self.child_two, "two.txt", "two\n")
        first = self.invoke(self.child_one)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        first_head = self.git(self.integration, "rev-parse", "HEAD")
        second = self.invoke(self.child_two)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        for child in (self.child_one, self.child_two):
            metadata_path = Path(self.git(child, "rev-parse", "--absolute-git-dir")) / "blue-whale" / "task-base.json"
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertEqual(parent if child == self.child_one else first_head,
                             metadata["inherited_sha"])
        source_head = self.git(self.integration, "rev-parse", "HEAD")
        self.assertEqual(self.git(self.integration, "rev-list", "--merges", f"{self.base}..HEAD"), "")
        self.assertEqual((self.integration / "integration.txt").read_text(), "integration\n")
        self.assertEqual((self.integration / "one.txt").read_text(), "one\n")
        self.assertEqual((self.integration / "two.txt").read_text(), "two\n")

        self.git(self.integration, "push", "origin", INTEGRATION)
        cleaned = self.cleanup(self.snapshot(source_head))
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(self.child_one.exists())

    def test_inherited_child_from_merge_commit_release_start_fast_forwards(self):
        self.merged_release_start()
        self.commit(self.child_one, "one.txt", "one\n")
        merged = self.invoke(self.child_one)
        self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual((self.integration / "one.txt").read_text(), "one\n")
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"),
                         self.git(self.child_one, "rev-parse", "HEAD"))

    def test_inherited_child_from_merge_commit_release_start_rejects_extra_merge(self):
        self.merged_release_start()
        self.git(self.main, "switch", "-c", "child-side", self.base)
        self.commit(self.main, "child-side.txt", "side\n")
        self.commit(self.child_one, "one.txt", "one\n")
        self.git(self.child_one, "merge", "--no-ff", "--no-edit", "-m",
                 "chore: extra child merge", "child-side")
        child_head = self.git(self.child_one, "rev-parse", "HEAD")
        stopped = self.invoke(self.child_one)
        self.assertNotEqual(stopped.returncode, 0)
        self.assertIn("子任务继承历史不符", stopped.stdout)
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"), self.base)
        self.assertEqual(self.git(self.child_one, "rev-parse", "HEAD"), child_head)

    def test_inherited_child_waits_for_release_sync_then_keeps_both_sides(self):
        parent = self.commit(self.integration, "integration.txt", "integration\n")
        self.git(self.main, "switch", "release/test")
        release = self.commit(self.main, "release.txt", "release\n")
        self.git(self.main, "push", "origin", "release/test")
        self.git(self.child_one, "merge", "--ff-only", release)
        self.git(self.child_one, "merge", "--no-ff", "--no-edit", "-m",
                 "chore: 继承整包父整合提交", parent)
        inherited = self.git(self.child_one, "rev-parse", "HEAD")
        metadata_path = Path(self.git(self.child_one, "rev-parse", "--absolute-git-dir")) / "blue-whale" / "task-base.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["start_sha"] = release
        metadata["inherited_sha"] = inherited
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        (metadata_path.parent / "task-integration-sha").write_text(inherited + "\n", encoding="utf-8")
        child_head = self.commit(self.child_one, "one.txt", "one\n")

        stopped = self.invoke(self.child_one)
        self.assertNotEqual(stopped.returncode, 0)
        self.assertIn("先同步父整合分支", stopped.stdout)
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"), parent)
        self.assertEqual(self.git(self.child_one, "rev-parse", "HEAD"), child_head)

        self.git(self.integration, "rebase", release)
        merged = self.invoke(self.child_one)
        self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual((self.integration / "release.txt").read_text(), "release\n")
        self.assertEqual((self.integration / "integration.txt").read_text(), "integration\n")
        self.assertEqual((self.integration / "one.txt").read_text(), "one\n")
        self.assertEqual(self.git(self.integration, "rev-list", "--merges", f"{release}..HEAD"), "")
        self.git(self.integration, "push", "origin", INTEGRATION)
        cleaned = self.cleanup(self.snapshot(self.git(self.integration, "rev-parse", "HEAD")))
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)

    def test_inherited_child_merges_after_release_sync_with_equivalent_tree(self):
        self.synced_inherited_child_with_added_file()
        merged = self.invoke(self.child_one)
        self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual((self.integration / "validation.md").read_text(), "parent\nchild\n")
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"),
                         self.git(self.child_one, "rev-parse", "HEAD"))

    def test_inherited_child_merges_after_release_sync_and_local_fix(self):
        self.synced_inherited_child_with_added_file()
        self.commit(self.integration, "local-fix.txt", "fix\n")
        merged = self.invoke(self.child_one)
        self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual((self.integration / "validation.md").read_text(), "parent\nchild\n")
        self.assertEqual((self.integration / "local-fix.txt").read_text(), "fix\n")
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"),
                         self.git(self.child_one, "rev-parse", "HEAD"))

    def test_release_sync_tree_mismatch_keeps_default_merge_conflict(self):
        self.synced_inherited_child_with_added_file()
        (self.integration / "later.txt").write_text("later\n", encoding="utf-8")
        self.git(self.integration, "add", "later.txt")
        self.git(self.integration, "commit", "--amend", "--no-edit")
        integration_head = self.git(self.integration, "rev-parse", "HEAD")
        child_head = self.git(self.child_one, "rev-parse", "HEAD")
        stopped = self.invoke(self.child_one)
        self.assertNotEqual(stopped.returncode, 0)
        self.assertIn("合并冲突", stopped.stdout)
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"), integration_head)
        self.assertEqual(self.git(self.child_one, "rev-parse", "HEAD"), child_head)

    def test_release_sync_explicit_merge_base_conflict_keeps_both_branches(self):
        self.synced_inherited_child_with_added_file(release_shared=True, child_shared=True)
        integration_head = self.git(self.integration, "rev-parse", "HEAD")
        child_head = self.git(self.child_one, "rev-parse", "HEAD")
        stopped = self.invoke(self.child_one)
        self.assertNotEqual(stopped.returncode, 0)
        self.assertIn("合并冲突", stopped.stdout)
        self.assertIn("shared.txt", stopped.stdout)
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"), integration_head)
        self.assertEqual(self.git(self.child_one, "rev-parse", "HEAD"), child_head)

    def test_conflict_keeps_both_branches_and_original_child_head(self):
        self.commit(self.integration, "shared.txt", "integration\n")
        original = self.commit(self.child_one, "shared.txt", "child\n")
        integration = self.git(self.integration, "rev-parse", "HEAD")
        result = self.invoke(self.child_one)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("冲突", result.stdout)
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"), integration)
        self.assertEqual(self.git(self.child_one, "rev-parse", "HEAD"), original)

    def test_shared_child_stops_before_rebase(self):
        original = self.commit(self.child_one, "one.txt", "one\n")
        self.git(self.child_one, "push", "origin", CHILD_ONE)
        result = self.invoke(self.child_one)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("已共享", result.stdout)
        self.assertEqual(self.git(self.child_one, "rev-parse", "HEAD"), original)

    def test_tree_mismatch_keeps_integration_and_recovery_ref(self):
        self.commit(self.integration, "integration.txt", "integration\n")
        self.commit(self.child_one, "one.txt", "one\n")
        original = self.git(self.integration, "rev-parse", "HEAD")
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        fake_git = fake_bin / "git"
        fake_git.write_text(
            '#!/bin/sh\ncase "$*" in *"rev-parse HEAD^{tree}"*) printf "%040d\\n" 0; exit 0;; esac\n'
            'exec "$REAL_GIT" "$@"\n', encoding="utf-8"
        )
        fake_git.chmod(0o755)
        env = {**os.environ, "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
               "REAL_GIT": shutil.which("git")}
        result = self.invoke(self.child_one, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("文件树", result.stdout)
        self.assertEqual(self.git(self.integration, "rev-parse", "HEAD"), original)
        self.assertEqual(run("git", "show-ref", "--verify",
                             "refs/agent-implement-spec-backups/fix%IKIOS6-第一子任务验证",
                             cwd=self.integration).returncode, 0)

    def test_cleanup_accepts_remote_pr_source_before_release_merge(self):
        self.commit(self.child_one, "one.txt", "one\n")
        self.assertEqual(self.invoke(self.child_one).returncode, 0)
        source_head = self.git(self.integration, "rev-parse", "HEAD")
        self.git(self.integration, "push", "origin", INTEGRATION)
        result = self.cleanup(self.snapshot(source_head))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.child_one.exists())
        self.assertEqual(self.git(self.main, "rev-parse", "release/test"), self.base)
        self.assertNotEqual(run("git", "show-ref", "--verify", f"refs/heads/{CHILD_ONE}",
                                cwd=self.main, check=False).returncode, 0)

    def test_cleanup_rejects_unmerged_child(self):
        self.commit(self.child_one, "one.txt", "one\n")
        self.git(self.integration, "push", "origin", INTEGRATION)
        source_head = self.git(self.integration, "rev-parse", "HEAD")
        result = self.cleanup(self.snapshot(source_head))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("尚未包含", result.stdout)
        self.assertTrue(self.child_one.exists())

    def test_cleanup_rejects_remote_source_change_after_fetch(self):
        self.commit(self.child_one, "one.txt", "one\n")
        self.assertEqual(self.invoke(self.child_one).returncode, 0)
        source_head = self.git(self.integration, "rev-parse", "HEAD")
        self.git(self.integration, "push", "origin", INTEGRATION)
        fake_bin = self.root / "fake-cleanup-git"
        fake_bin.mkdir()
        fake_git = fake_bin / "git"
        fake_git.write_text(
            '#!/bin/sh\ncase "$*" in *"ls-remote --heads origin refs/heads/docs/IKIOS6-整包集成验证"*)'
            ' printf "%040d\\trefs/heads/docs/IKIOS6-整包集成验证\\n" 0; exit 0;; esac\n'
            'exec "$REAL_GIT" "$@"\n', encoding="utf-8"
        )
        fake_git.chmod(0o755)
        env = {**os.environ, "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
               "REAL_GIT": shutil.which("git")}
        result = self.cleanup(self.snapshot(source_head), env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("核验期间变化", result.stdout)
        self.assertTrue(self.child_one.exists())


if __name__ == "__main__":
    unittest.main()
