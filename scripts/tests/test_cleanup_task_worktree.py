#!/usr/bin/env python3

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    from .bash_helper import BASH
except ImportError:
    from bash_helper import BASH


SCRIPTS = Path(__file__).resolve().parents[1]
TASK_BRANCH = "chore/IKICLS-清理发布线任务区"
TARGET_BRANCH = "release/2026.09.29"


def run(*args, cwd, check=True):
    result = subprocess.run([str(arg) for arg in args], cwd=cwd, text=True,
                            encoding="utf-8", stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if check and result.returncode:
        raise AssertionError(f"{args}\nstdout: {result.stdout}\nstderr: {result.stderr}")
    return result


class CleanupTaskWorktreeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.origin = self.root / "origin.git"
        self.main = self.root / "project"
        self.task = self.root / "blue-whale-worktrees" / "task"
        self.actor = self.root / "actor"
        run("git", "init", "--bare", "--initial-branch=master", self.origin, cwd=self.root)
        run("git", "init", "--initial-branch=master", self.main, cwd=self.root)
        self.configure_user(self.main)
        scripts = self.main / "scripts"
        (scripts / "lib").mkdir(parents=True)
        shutil.copy2(SCRIPTS / "cleanup-task-worktree.sh", scripts)
        shutil.copy2(SCRIPTS / "list-task-worktrees.sh", scripts)
        for name in ("worktree-paths.sh", "python3-command.sh", "task_metadata.py"):
            shutil.copy2(SCRIPTS / "lib" / name, scripts / "lib")
        (self.main / "base.txt").write_text("base\n", encoding="utf-8")
        run("git", "add", ".", cwd=self.main)
        run("git", "commit", "-m", "chore: test base", cwd=self.main)
        run("git", "remote", "add", "origin", self.origin, cwd=self.main)
        run("git", "push", "origin", "master", cwd=self.main)
        run("git", "switch", "-c", TARGET_BRANCH, cwd=self.main)
        self.start_sha = run("git", "rev-parse", "HEAD", cwd=self.main).stdout.strip()
        run("git", "push", "origin", TARGET_BRANCH, cwd=self.main)
        run("git", "switch", "master", cwd=self.main)
        self.task.parent.mkdir()
        run("git", "worktree", "add", "-b", TASK_BRANCH, self.task, TARGET_BRANCH,
            cwd=self.main)
        run(sys.executable, self.task / "scripts/lib/task_metadata.py", "repair",
            "--worktree", self.task, "--target-branch", TARGET_BRANCH,
            "--start-sha", self.start_sha, "--user-authorized", cwd=self.task)
        (self.task / "task.txt").write_text("task\n", encoding="utf-8")
        run("git", "add", "task.txt", cwd=self.task)
        run("git", "commit", "-m", "chore: task change", cwd=self.task)
        self.task_sha = run("git", "rev-parse", "HEAD", cwd=self.task).stdout.strip()
        run("git", "push", "origin", TASK_BRANCH, cwd=self.task)
        run("git", "clone", self.origin, self.actor, cwd=self.root)
        self.configure_user(self.actor)

    @staticmethod
    def configure_user(repo):
        run("git", "config", "user.name", "Cleanup Test", cwd=repo)
        run("git", "config", "user.email", "cleanup@example.com", cwd=repo)

    def merge_remote(self, branch):
        if branch != "master":
            run("git", "switch", "--track", f"origin/{branch}", cwd=self.actor)
        run("git", "merge", "--no-ff", "--no-edit", f"origin/{TASK_BRANCH}", cwd=self.actor)
        run("git", "push", "origin", branch, cwd=self.actor)

    def cleanup(self):
        return run(BASH, self.task / "scripts/cleanup-task-worktree.sh",
                   cwd=self.task, check=False)

    def inspect(self):
        return run(BASH, self.main / "scripts/list-task-worktrees.sh",
                   cwd=self.main, check=False)

    def assert_local_intact(self):
        self.assertTrue(self.task.is_dir())
        self.assertEqual(self.task_sha, run("git", "rev-parse", TASK_BRANCH,
                                            cwd=self.main).stdout.strip())

    def test_release_contains_task_without_master_and_retains_remote_task_branch(self):
        self.merge_remote(TARGET_BRANCH)
        self.assertNotEqual(self.task_sha, run("git", "rev-parse", "master",
                                                cwd=self.main).stdout.strip())
        self.assertEqual(self.start_sha, run("git", "rev-parse", f"origin/{TARGET_BRANCH}",
                                              cwd=self.main).stdout.strip(),
                         "remote tracking ref must remain stale for this test")
        result = self.cleanup()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertFalse(self.task.exists())
        self.assertNotEqual(0, run("git", "show-ref", "--verify", f"refs/heads/{TASK_BRANCH}",
                                   cwd=self.main, check=False).returncode)
        self.assertIn(self.task_sha, run("git", "ls-remote", "--heads", "origin",
                                          f"refs/heads/{TASK_BRANCH}", cwd=self.main).stdout)

    def test_inspection_recommends_cleanup_after_release_merge_without_master(self):
        self.merge_remote(TARGET_BRANCH)

        result = self.inspect()

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn(f"目标发布线: {TARGET_BRANCH}", result.stdout)
        self.assertIn("目标发布线包含任务: merged", result.stdout)
        self.assertIn("可进入该 worktree 执行 scripts/cleanup-task-worktree.sh", result.stdout)

    def test_inspection_keeps_unknown_when_remote_unreachable(self):
        run("git", "remote", "set-url", "origin", self.root / "missing.git", cwd=self.task)

        result = self.inspect()

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("目标发布线包含任务: unknown", result.stdout)
        self.assertIn("核对任务元数据或远端状态后重试", result.stdout)
        self.assertNotIn("可进入该 worktree 执行", result.stdout)

    def test_inspection_keeps_unknown_when_metadata_missing(self):
        metadata = run("git", "rev-parse", "--absolute-git-dir", cwd=self.task).stdout.strip()
        (Path(metadata) / "blue-whale" / "task-base.json").unlink()

        result = self.inspect()

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("目标发布线: 元数据不可用", result.stdout)
        self.assertIn("目标发布线包含任务: unknown", result.stdout)
        self.assertNotIn("可进入该 worktree 执行", result.stdout)

    def test_only_master_contains_task(self):
        self.merge_remote("master")
        result = self.cleanup()
        self.assertNotEqual(0, result.returncode)
        self.assertIn(TARGET_BRANCH, result.stderr)
        self.assertIn("尚未包含", result.stderr)
        self.assert_local_intact()

    def test_target_release_does_not_contain_task(self):
        result = self.cleanup()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("尚未包含", result.stderr)
        self.assert_local_intact()

    def test_dirty_worktree_is_preserved(self):
        self.merge_remote(TARGET_BRANCH)
        (self.task / "unsaved.txt").write_text("unsaved\n", encoding="utf-8")
        result = self.cleanup()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("工作区不干净", result.stderr)
        self.assert_local_intact()

    def test_unreachable_remote_is_preserved(self):
        self.merge_remote(TARGET_BRANCH)
        run("git", "remote", "set-url", "origin", self.root / "missing.git", cwd=self.task)
        result = self.cleanup()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("无法读取远端目标", result.stderr)
        self.assert_local_intact()

    def test_missing_metadata_is_preserved(self):
        metadata = run("git", "rev-parse", "--absolute-git-dir", cwd=self.task).stdout.strip()
        (Path(metadata) / "blue-whale" / "task-base.json").unlink()
        self.merge_remote(TARGET_BRANCH)
        result = self.cleanup()
        self.assertNotEqual(0, result.returncode)
        self.assertIn("任务基线元数据", result.stderr)
        self.assert_local_intact()


if __name__ == "__main__":
    unittest.main()
