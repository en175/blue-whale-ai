#!/usr/bin/env python3

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    from .bash_helper import BASH
except ImportError:
    from bash_helper import BASH


SOURCE = Path(__file__).resolve().parents[2]


def command(*args, cwd, check=True):
    result = subprocess.run(
        [str(arg) for arg in args], cwd=cwd, text=True, encoding="utf-8",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if check and result.returncode:
        raise AssertionError(f"{args}: {result.stdout}\n{result.stderr}")
    return result


class ReleaseTaskWorkflowTest(unittest.TestCase):
    def test_sync_start_verify_publish_gate_and_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            origin = root / "origin.git"
            main = root / "main"
            release = root / "blue-whale-worktrees" / "release-local"
            actor = root / "actor"
            command("git", "init", "--bare", "--initial-branch=master", origin, cwd=root)
            command("git", "init", "--initial-branch=master", main, cwd=root)
            for directory in ("scripts", "tests", "docs/agents", "agent-rules", ".agents/skills", ".superpowers/skills"):
                shutil.copytree(SOURCE / directory, main / directory)
            (main / ".claude").mkdir()
            (main / ".claude/skills").symlink_to("../.agents/skills", target_is_directory=True)
            for filename in ("CLAUDE.md", "AGENTS.md", "package.json"):
                shutil.copy2(SOURCE / filename, main / filename)
            (main / ".githooks").mkdir()
            (main / ".githooks/pre-push").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            (main / ".githooks/pre-push").chmod(0o755)
            self.configure(main)
            command("git", "-C", main, "add", ".", cwd=root)
            command("git", "-C", main, "commit", "-m", "test: task workflow baseline", cwd=root)
            command("git", "-C", main, "remote", "add", "origin", origin, cwd=root)
            command("git", "-C", main, "push", "-u", "origin", "master", cwd=root)
            created = command(BASH, main / "scripts/manage-release-branch.sh", "create",
                              "--summary", "发布任务完整演练", "--user-authorized", "--json", cwd=main)
            line = json.loads(created.stdout)["branch"]
            command("git", "-C", main, "worktree", "add", release, line, cwd=root)
            command("git", "clone", origin, actor, cwd=root)
            self.configure(actor)
            command("git", "-C", actor, "switch", "--track", f"origin/{line}", cwd=root)

            (actor / "teammate.txt").write_text("shared\n", encoding="utf-8")
            command("git", "-C", actor, "add", "teammate.txt", cwd=root)
            command("git", "-C", actor, "commit", "-m", "test: teammate change", cwd=root)
            teammate_sha = command("git", "-C", actor, "rev-parse", "HEAD", cwd=root).stdout.strip()
            command("git", "-C", actor, "push", "origin", line, cwd=root)
            synchronized = command(BASH, release / "scripts/sync-release-line.sh", "--json", cwd=release)
            self.assertEqual(json.loads(synchronized.stdout)["action"], "fast_forward")
            self.assertEqual(json.loads(synchronized.stdout)["hooks_path"], ".githooks")
            self.assertEqual(command("git", "-C", release, "rev-parse", "HEAD", cwd=root).stdout.strip(), teammate_sha)

            (release / "local.txt").write_text("unshared baseline\n", encoding="utf-8")
            command("git", "-C", release, "add", "local.txt", cwd=root)
            command("git", "-C", release, "commit", "-m", "test: local release commit", cwd=root)
            start_sha = command("git", "-C", release, "rev-parse", "HEAD", cwd=root).stdout.strip()
            started = command(BASH, release / "scripts/start-task-worktree.sh", "--type", "docs",
                              "--no-issue", "--summary", "补全发布任务演练", cwd=release)
            task = Path(next(part.split("：", 1)[1] for part in started.stdout.splitlines() if part.startswith("✅ Work Tree：")))
            task_branch = command("git", "-C", task, "branch", "--show-current", cwd=root).stdout.strip()
            metadata = json.loads(command("python3", task / "scripts/lib/task_metadata.py", "read", "--json", cwd=task).stdout)
            self.assertEqual(metadata["start_sha"], start_sha)
            self.assertEqual(metadata["target_branch"], line)

            (task / "docs/rehearsal.md").write_text("# 发布任务演练\n", encoding="utf-8")
            command("git", "-C", task, "add", "docs/rehearsal.md", cwd=root)
            command("git", "-C", task, "commit", "-m", "docs: record rehearsal", cwd=root)
            plan = json.loads(command("node", task / "scripts/verify-change-scope.mjs", "plan", "--stage", "pr", "--json", cwd=task).stdout)
            self.assertEqual(plan["classification"]["tier"], "docs")
            blocked = command(BASH, task / "scripts/publish-review-package.sh", "--user-authorized",
                              "--create-pr", "--target-branch", line, "--draft-pr", "--json", cwd=task, check=False)
            self.assertEqual(blocked.returncode, 12, blocked.stderr)
            self.assertEqual(json.loads(blocked.stdout)["status"], "TASK_BASE_NOT_SHARED")
            self.assertFalse(command("git", "-C", task, "ls-remote", "--heads", "origin", f"refs/heads/{task_branch}", cwd=root).stdout.strip())

            command("git", "-C", release, "push", "origin", line, cwd=root)
            published = command(BASH, task / "scripts/publish-review-package.sh", "--user-authorized",
                                "--create-pr", "--target-branch", line, "--draft-pr", "--json", cwd=task)
            self.assertEqual(json.loads(published.stdout.strip().splitlines()[-1])["status"], "PUSHED_CREATE_PR")
            common = Path(command("git", "-C", task, "rev-parse", "--git-common-dir", cwd=root).stdout.strip())
            if not common.is_absolute():
                common = (task / common).resolve()
            marker = common / ("agent-release-review-package-" + task_branch.replace("/", "%"))
            self.assertIn("draft=true", marker.read_text(encoding="utf-8"))
            task_head = command("git", "-C", task, "rev-parse", "HEAD", cwd=root).stdout.strip()
            receipt = json.loads((common / "blue-whale/verification" / f"{task_head}.json").read_text(encoding="utf-8"))
            self.assertEqual("passed", receipt["status"])

            command("git", "-C", actor, "fetch", "origin", cwd=root)
            command("git", "-C", actor, "merge", "--ff-only", f"origin/{line}", cwd=root)
            command("git", "-C", actor, "merge", "--no-ff", "--no-edit", f"origin/{task_branch}", cwd=root)
            command("git", "-C", actor, "push", "origin", line, cwd=root)
            cleaned = command(BASH, task / "scripts/cleanup-task-worktree.sh", cwd=task)
            self.assertIn("已清理", cleaned.stdout)
            self.assertFalse(task.exists())
            self.assertTrue(command("git", "-C", main, "ls-remote", "--heads", "origin", f"refs/heads/{task_branch}", cwd=root).stdout.strip())

    @staticmethod
    def configure(repo):
        command("git", "-C", repo, "config", "user.name", "Workflow Test", cwd=repo)
        command("git", "-C", repo, "config", "user.email", "workflow-test@example.com", cwd=repo)
        command("git", "-C", repo, "config", "core.hooksPath", "/dev/null", cwd=repo)


if __name__ == "__main__":
    unittest.main()
