#!/usr/bin/env python3

import json
import os
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


SOURCE = Path(__file__).resolve().parents[1] / "start-task-worktree.py"
SOURCE_SH = Path(__file__).resolve().parents[1] / "start-task-worktree.sh"
SOURCE_LIB = Path(__file__).resolve().parents[1] / "lib" / "python3-command.sh"
SOURCE_PRE_PUSH = Path(__file__).resolve().parents[2] / ".githooks/pre-push"
SOURCE_SYNC = Path(__file__).resolve().parents[1] / "lib" / "release_line_sync.py"
SOURCE_STATE = Path(__file__).resolve().parents[1] / "lib" / "release-line-state.py"
SOURCE_METADATA = Path(__file__).resolve().parents[1] / "lib" / "task_metadata.py"
SOURCE_MERGE_CHILD = Path(__file__).resolve().parents[1] / "merge-implement-spec-child.py"


def run(*args, cwd, check=True):
    if args and args[0] == "bash":
        args = (BASH,) + args[1:]
    result = subprocess.run(
        [str(arg) for arg in args],
        cwd=str(cwd),
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        raise AssertionError(
            "command failed: {}\nstdout:\n{}\nstderr:\n{}".format(
                " ".join(str(arg) for arg in args), result.stdout, result.stderr
            )
        )
    return result


class StartTaskWorktreeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.main = self.root / "project"
        self.repo = self.root / "blue-whale-worktrees" / "release-test"
        self.origin = self.root / "origin.git"
        self.actor = self.root / "actor"

        self.assertTrue(SOURCE.exists(), "production entrypoint does not exist yet")
        self.assertTrue(SOURCE_SH.exists(), "shell compatibility wrapper does not exist")
        self.assertTrue(SOURCE_LIB.exists(), "shared python3 launcher lib does not exist")
        self.assertTrue(SOURCE_PRE_PUSH.exists(), "pre-push hook does not exist")
        run("git", "init", "--bare", "--initial-branch=master", self.origin, cwd=self.root)
        run("git", "init", "--initial-branch=master", self.main, cwd=self.root)
        self.configure_user(self.main)

        scripts = self.main / "scripts"
        scripts.mkdir()
        shutil.copy2(SOURCE, scripts / SOURCE.name)
        shutil.copy2(SOURCE_SH, scripts / SOURCE_SH.name)
        lib = scripts / "lib"
        lib.mkdir()
        shutil.copy2(SOURCE_LIB, lib / SOURCE_LIB.name)
        for source in (SOURCE_SYNC, SOURCE_STATE, SOURCE_METADATA):
            shutil.copy2(source, lib / source.name)
        for name in ("verify-change-scope.mjs", "verification-policy.mjs"):
            shutil.copy2(SOURCE.parent / name, scripts / name)
        shutil.copy2(Path(__file__).resolve().parents[1] / "manage-release-branch.sh", scripts / "manage-release-branch.sh")
        hooks = self.main / ".githooks"
        hooks.mkdir()
        shutil.copy2(SOURCE_PRE_PUSH, hooks / "pre-push")
        (self.main / "shared.txt").write_text("base\n", encoding="utf-8")
        run("git", "add", ".", cwd=self.main)
        run("git", "commit", "-m", "chore: 初始化测试仓库", cwd=self.main)
        run("git", "remote", "add", "origin", self.origin, cwd=self.main)
        run("git", "push", "-u", "origin", "master", cwd=self.main)
        created = run(BASH, self.main / "scripts/manage-release-branch.sh", "create",
                      "--summary", "发布流程验证", "--user-authorized", "--json", cwd=self.main)
        self.release_branch = json.loads(created.stdout)["branch"]
        self.master_branch = "master"
        run("git", "worktree", "add", self.repo, self.release_branch, cwd=self.main)

        run("git", "clone", self.origin, self.actor, cwd=self.root)
        self.configure_user(self.actor)
        run("git", "switch", "--track", f"origin/{self.release_branch}", cwd=self.actor)

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def configure_user(repo):
        run("git", "config", "user.name", "Worktree Test", cwd=repo)
        run("git", "config", "user.email", "worktree-test@example.com", cwd=repo)

    @staticmethod
    def commit(repo, filename, content, message):
        (repo / filename).write_text(content, encoding="utf-8")
        run("git", "add", filename, cwd=repo)
        run("git", "commit", "-m", message, cwd=repo)
        return run("git", "rev-parse", "HEAD", cwd=repo).stdout.strip()

    def invoke(self, *args):
        if args[:1] == ("--validate-branch",) or "--target-branch" in args:
            return run(sys.executable, self.repo / "scripts/start-task-worktree.py", *args, cwd=self.repo, check=False)
        return run(sys.executable, self.repo / "scripts/start-task-worktree.py", *args,
                   "--target-branch", self.release_branch, cwd=self.repo, check=False)

    def pre_push(self, branch, sha=None, remote_sha=None):
        sha = sha or run("git", "rev-parse", "HEAD", cwd=self.repo).stdout.strip()
        remote_sha = remote_sha or "0" * 40
        return subprocess.run(
            [BASH, str(self.repo / ".githooks/pre-push")],
            cwd=str(self.repo),
            input="refs/heads/{0} {1} refs/heads/{0} {2}\n".format(
                branch, sha, remote_sha
            ),
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def task_worktrees(self):
        output = run("git", "worktree", "list", "--porcelain", cwd=self.repo).stdout
        paths = [
            Path(line.removeprefix("worktree "))
            for line in output.splitlines()
            if line.startswith("worktree ")
        ]
        tasks = [path for path in paths if path.resolve() not in (self.repo.resolve(), self.main.resolve())]
        return tasks

    def task_worktree(self):
        tasks = self.task_worktrees()
        self.assertEqual(1, len(tasks), tasks)
        return tasks[0]

    def assert_worktree_matches_release(self):
        task = self.task_worktree()
        master_sha = run("git", "rev-parse", "origin/master", cwd=self.repo).stdout.strip()
        task_sha = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        self.assertEqual(master_sha, task_sha)
        return task

    def test_generates_structured_chinese_branch(self):
        result = self.invoke(
            "--type", "fix", "--issue", "IK094T", "--summary", "修复工作树写入护栏"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        task = self.assert_worktree_matches_release()
        self.assertEqual(self.repo.parent.resolve(), task.parent.resolve())
        branch = run("git", "branch", "--show-current", cwd=task).stdout.strip()
        self.assertEqual("fix/IK094T-修复工作树写入护栏", branch)
        self.assertEqual(".githooks", run("git", "config", "--get", "core.hooksPath", cwd=task).stdout.strip())
        before = run("git", "rev-parse", "origin/master", cwd=task).stdout.strip()
        self.commit(task, "task.txt", "new task commit\n", "chore: 自动启用验证")
        blocked = run("git", "push", "origin", "HEAD:master", cwd=task, check=False)
        self.assertNotEqual(0, blocked.returncode)
        self.assertIn("master", blocked.stderr)
        self.assertEqual(before, run("git", "ls-remote", "--heads", "origin", "master", cwd=task).stdout.split()[0])

    def test_shell_wrapper_only_forwards_structured_arguments(self):
        result = run(
            "bash",
            self.repo / "scripts/start-task-worktree.sh",
            "--type",
            "docs",
            "--no-issue",
            "--summary",
            "补全工作树使用说明",
            "--target-branch",
            self.release_branch,
            cwd=self.repo,
            check=False,
        )
        self.assertEqual(0, result.returncode, result.stderr)
        task = self.assert_worktree_matches_release()
        branch = run("git", "branch", "--show-current", cwd=task).stdout.strip()
        self.assertEqual("docs/补全工作树使用说明", branch)

    def test_branch_validation_mode_supports_hooks(self):
        valid = self.invoke("--validate-branch", "chore/实施极简工作树流程")
        self.assertEqual(0, valid.returncode, valid.stderr)
        for branch in ("dev", "test", "release"):
            with self.subTest(branch=branch):
                environment = self.invoke("--validate-branch", branch)
                self.assertEqual(0, environment.returncode, environment.stderr)
        invalid_branches = (
            "bug/修复工作树写入护栏",
            "chore/implement-worktree",
            "chore/中文短",
            "chore/完善_工作树启动流程",
            "chore/完善 工作树启动流程",
            "chore/完善-工作树启动流程",
            "fix/123-修复工作树写入护栏",
        )
        for branch in invalid_branches:
            with self.subTest(branch=branch):
                invalid = self.invoke("--validate-branch", branch)
                self.assertNotEqual(0, invalid.returncode, branch)

    def test_pre_push_blocks_invalid_name_and_allows_valid_chinese_name(self):
        valid = self.pre_push("chore/实施极简工作树流程")
        invalid = self.pre_push("chore/implement-worktree")
        self.assertEqual(0, valid.returncode, valid.stderr)
        self.assertNotEqual(0, invalid.returncode)
        self.assertIn("结构化中文规范", invalid.stderr)

    def test_pre_push_allows_valid_task_branch_behind_master(self):
        run("git", "switch", "master", cwd=self.actor)
        self.commit(self.actor, "upstream.txt", "upstream\n", "chore: 推进主干")
        run("git", "push", "origin", "master", cwd=self.actor)

        stale_sha = run("git", "rev-parse", "HEAD", cwd=self.repo).stdout.strip()
        result = self.pre_push("chore/实施极简工作树流程", stale_sha)

        self.assertEqual(0, result.returncode, result.stderr)

    def test_pre_push_without_upstream_only_skips_staleness_check(self):
        run("git", "remote", "remove", "origin", cwd=self.repo)
        valid = self.pre_push("chore/实施极简工作树流程")
        invalid = self.pre_push("chore/implement-worktree")
        protected = self.pre_push("master")
        self.assertEqual(0, valid.returncode, valid.stderr)
        self.assertNotEqual(0, invalid.returncode)
        self.assertIn("结构化中文规范", invalid.stderr)
        self.assertNotEqual(0, protected.returncode)
        self.assertIn("禁止直推", protected.stderr)

    def test_pre_push_blocks_deleting_protected_branch(self):
        zero = "0" * 40
        remote_sha = run("git", "rev-parse", "origin/master", cwd=self.repo).stdout.strip()
        deletion = self.pre_push("master", sha=zero, remote_sha=remote_sha)
        self.assertNotEqual(0, deletion.returncode)
        self.assertIn("禁止直推", deletion.stderr)

    def test_pre_push_allows_already_published_legacy_ascii_branch(self):
        run("git", "checkout", "-b", "chore/legacy-ascii", cwd=self.actor)
        run("git", "push", "-u", "origin", "chore/legacy-ascii", cwd=self.actor)
        legacy_sha = run("git", "rev-parse", "HEAD", cwd=self.actor).stdout.strip()
        legacy = self.pre_push(
            "chore/legacy-ascii", legacy_sha, remote_sha=legacy_sha
        )
        self.assertEqual(0, legacy.returncode, legacy.stderr)

    def test_pre_push_does_not_trust_stale_remote_tracking_ref(self):
        sha = run("git", "rev-parse", "HEAD", cwd=self.repo).stdout.strip()
        run(
            "git",
            "update-ref",
            "refs/remotes/origin/chore/new-ascii",
            sha,
            cwd=self.repo,
        )
        new_branch = self.pre_push("chore/new-ascii", sha)
        self.assertNotEqual(0, new_branch.returncode)
        self.assertIn("结构化中文规范", new_branch.stderr)

    def test_rejects_ascii_summary_without_creating_worktree(self):
        before = run("git", "rev-parse", self.release_branch, cwd=self.repo).stdout.strip()
        result = self.invoke(
            "--type", "fix", "--no-issue", "--summary", "fixworktree"
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("中文", result.stderr)
        self.assertEqual(before, run("git", "rev-parse", self.release_branch, cwd=self.repo).stdout.strip())
        self.assertEqual(0, len(self.task_worktrees()))

    def test_local_uncommitted_files_do_not_enter_task_base(self):
        (self.repo / "dirty.txt").write_text("dirty\n", encoding="utf-8")
        result = self.invoke(
            "--type", "chore", "--no-issue", "--summary", "完善工作树启动流程"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertFalse((self.task_worktree() / "dirty.txt").exists())
        self.assertTrue((self.repo / "dirty.txt").exists())

    def test_in_progress_merge_does_not_move_task_base(self):
        self.commit(self.repo, "shared.txt", "same\n", "fix: 修改本地共享内容")
        self.commit(self.actor, "shared.txt", "same\n", "fix: 修改远程共享内容")
        run("git", "push", "origin", "HEAD:master", cwd=self.actor)
        run("git", "fetch", "origin", self.master_branch, cwd=self.repo)
        run("git", "merge", "--no-commit", "--no-ff", f"origin/{self.master_branch}", cwd=self.repo)
        merge_head = run("git", "rev-parse", "--verify", "MERGE_HEAD", cwd=self.repo).stdout.strip()

        result = self.invoke(
            "--type", "fix", "--no-issue", "--summary", "保护进行中合并状态"
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assert_worktree_matches_release()
        self.assertEqual(
            merge_head,
            run("git", "rev-parse", "--verify", "MERGE_HEAD", cwd=self.repo).stdout.strip(),
        )
        run("git", "merge", "--abort", cwd=self.repo)

    def test_local_ahead_is_not_part_of_task_base(self):
        local_sha = self.commit(
            self.repo, "local.txt", "local\n", "feat: 添加本地模块改动"
        )
        result = self.invoke(
            "--type", "feature", "--no-issue", "--summary", "保留本地模块更新"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        task = self.assert_worktree_matches_release()
        self.assertNotEqual(local_sha, run("git", "rev-parse", "HEAD", cwd=task).stdout.strip())
        self.assertIn(self.release_branch, result.stdout)
        metadata = self.read_metadata(task)
        self.assertEqual(self.release_branch, metadata["target_branch"])
        self.assertNotEqual(local_sha, metadata["start_sha"])

    def test_integration_child_inherits_fixed_parent_commit_after_master_sync(self):
        parent_start = self.invoke(
            "--type", "feature", "--issue", "IKPARENT", "--summary", "建立整包集成分支"
        )
        self.assertEqual(0, parent_start.returncode, parent_start.stderr)
        parent = self.repo.parent / "feature-ikparent"
        parent_head = self.commit(parent, "parent.txt", "parent\n", "feat: parent change")
        master_head = self.commit(self.actor, "remote.txt", "remote\n", "chore: advance master")
        run("git", "push", "origin", "HEAD:master", cwd=self.actor)

        child_start = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(parent),
        )

        self.assertEqual(0, child_start.returncode, child_start.stderr)
        child = self.repo.parent / "feature-ikchild"
        child_head = run("git", "rev-parse", "HEAD", cwd=child).stdout.strip()
        metadata = self.read_metadata(child)
        self.assertEqual(master_head, metadata["start_sha"])
        self.assertEqual(child_head, metadata["inherited_sha"])
        self.assertEqual(
            [master_head, parent_head],
            run("git", "show", "-s", "--format=%P", "HEAD", cwd=child).stdout.strip().split(),
        )
        self.assertEqual(parent_head, run("git", "rev-parse", "HEAD", cwd=parent).stdout.strip())
        self.commit(child, "child.txt", "child\n", "feat: child change")
        child_plan = json.loads(run("node", child / "scripts/verify-change-scope.mjs", "plan", "--json",
                                    cwd=child).stdout)
        self.assertEqual(child_head, child_plan["base"])
        self.assertEqual(["child.txt"], child_plan["changedFiles"])

        run("git", "merge", "--no-ff", "--no-edit", "-m", "feat: merge child",
            run("git", "rev-parse", "HEAD", cwd=child).stdout.strip(), cwd=parent)
        parent_plan = json.loads(run("node", parent / "scripts/verify-change-scope.mjs", "plan", "--json",
                                     cwd=parent).stdout)
        self.assertEqual(sorted(["child.txt", "parent.txt", "remote.txt"]), parent_plan["changedFiles"])

    def test_real_integration_child_merges_without_losing_parent_or_child(self):
        parent_start = self.invoke(
            "--type", "feature", "--issue", "IKPARENT", "--summary", "建立整包集成分支"
        )
        self.assertEqual(0, parent_start.returncode, parent_start.stderr)
        parent = self.repo.parent / "feature-ikparent"
        parent_head = self.commit(parent, "parent.txt", "parent\n", "feat: parent change")
        child_start = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(parent),
        )
        self.assertEqual(0, child_start.returncode, child_start.stderr)
        child = self.repo.parent / "feature-ikchild"
        inherited = self.read_metadata(child)["inherited_sha"]
        self.assertEqual(2, len(run("git", "show", "-s", "--format=%P", inherited,
                                    cwd=child).stdout.split()))
        self.commit(child, "child.txt", "child\n", "feat: child change")

        merged = run(sys.executable, SOURCE_MERGE_CHILD, "--child-worktree", child,
                     "--json", cwd=parent, check=False)

        self.assertEqual(0, merged.returncode, merged.stdout + merged.stderr)
        self.assertEqual("parent\n", (parent / "parent.txt").read_text(encoding="utf-8"))
        self.assertEqual("child\n", (parent / "child.txt").read_text(encoding="utf-8"))
        self.assertEqual(parent_head, self.read_metadata(child)["inherited_sha"])
        self.assertEqual("", run("git", "rev-list", "--merges", f"{self.read_metadata(child)['start_sha']}..HEAD",
                                 cwd=parent).stdout.strip())

    def test_integration_child_rejects_dirty_parent(self):
        self.assertEqual(0, self.invoke(
            "--type", "feature", "--issue", "IKPARENT", "--summary", "建立整包集成分支"
        ).returncode)
        parent = self.repo.parent / "feature-ikparent"
        (parent / "dirty.txt").write_text("dirty\n", encoding="utf-8")

        child_start = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(parent),
        )

        self.assertNotEqual(0, child_start.returncode)
        self.assertIn("父工作树不干净", child_start.stderr)
        self.assertFalse((self.repo.parent / "feature-ikchild").exists())
        self.assertEqual(1, len(self.task_worktrees()))

    def test_integration_child_repair_keeps_inherited_commit(self):
        self.assertEqual(0, self.invoke(
            "--type", "feature", "--issue", "IKPARENT", "--summary", "建立整包集成分支"
        ).returncode)
        parent = self.repo.parent / "feature-ikparent"
        self.commit(parent, "parent.txt", "parent\n", "feat: parent change")
        created = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(parent),
        )
        self.assertEqual(0, created.returncode, created.stderr)
        child = self.repo.parent / "feature-ikchild"
        metadata = self.read_metadata(child)
        git_dir = Path(run("git", "rev-parse", "--absolute-git-dir", cwd=child).stdout.strip())
        metadata_path = git_dir / "blue-whale/task-base.json"

        stripped = dict(metadata)
        stripped.pop("inherited_sha")
        metadata_path.write_text(json.dumps(stripped), encoding="utf-8")
        rejected = run(sys.executable, child / "scripts/lib/task_metadata.py", "read", "--worktree", child,
                       cwd=child, check=False)
        self.assertNotEqual(0, rejected.returncode)
        self.assertIn("继承标记", rejected.stderr)

        metadata_path.unlink()
        repaired = run(sys.executable, child / "scripts/lib/task_metadata.py", "repair", "--worktree", child,
                       "--target-branch", metadata["target_branch"], "--start-sha", metadata["start_sha"],
                       "--user-authorized", cwd=child, check=False)
        self.assertEqual(0, repaired.returncode, repaired.stderr)
        self.assertEqual(metadata, self.read_metadata(child))

    def test_integration_child_rejects_other_repository_and_target(self):
        other_repo = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(self.actor),
        )
        self.assertNotEqual(0, other_repo.returncode)
        self.assertIn("不属于同一仓库", other_repo.stderr)

        self.assertEqual(0, self.invoke(
            "--type", "feature", "--issue", "IKPARENT", "--summary", "建立整包集成分支"
        ).returncode)
        parent = self.repo.parent / "feature-ikparent"
        git_dir = Path(run("git", "rev-parse", "--absolute-git-dir", cwd=parent).stdout.strip())
        metadata_path = git_dir / "blue-whale/task-base.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["target_branch"] = "release/other"
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        other_target = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(parent),
        )
        self.assertNotEqual(0, other_target.returncode)
        self.assertIn("不匹配", other_target.stderr)
        self.assertFalse((self.repo.parent / "feature-ikchild").exists())

    def test_integration_conflict_cleans_child_and_keeps_synced_release(self):
        self.assertEqual(0, self.invoke(
            "--type", "feature", "--issue", "IKPARENT", "--summary", "建立整包集成分支"
        ).returncode)
        parent = self.repo.parent / "feature-ikparent"
        parent_head = self.commit(parent, "shared.txt", "parent\n", "feat: parent change")
        after_sync = self.commit(self.actor, "shared.txt", "release\n", "chore: advance master")
        run("git", "push", "origin", "HEAD:master", cwd=self.actor)

        child_start = self.invoke(
            "--type", "feature", "--issue", "IKCHILD", "--summary", "继承整包集成提交",
            "--integration-worktree", str(parent),
        )

        self.assertNotEqual(0, child_start.returncode)
        self.assertIn("整包继承合并失败", child_start.stderr)
        self.assertIn(after_sync, child_start.stderr)
        self.assertFalse((self.repo.parent / "feature-ikchild").exists())
        self.assertNotEqual(0, run("git", "show-ref", "--verify", "refs/heads/feature/IKCHILD-继承整包集成提交",
                                   cwd=self.repo, check=False).returncode)
        self.assertEqual(parent_head, run("git", "rev-parse", "HEAD", cwd=parent).stdout.strip())
        self.assertEqual(parent_head, run("git", "rev-parse", "HEAD", cwd=parent).stdout.strip())

    def read_metadata(self, task, *args):
        result = run(sys.executable, task / "scripts/lib/task_metadata.py", "read",
                     "--worktree", task, "--json", *args, cwd=task, check=False)
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout)

    def test_missing_metadata_and_explicit_target_conflict_fail_closed(self):
        result = self.invoke("--type", "fix", "--no-issue", "--summary", "保护任务基线记录")
        self.assertEqual(0, result.returncode, result.stderr)
        task = self.task_worktree()
        metadata_dir = Path(run("git", "rev-parse", "--absolute-git-dir", cwd=task).stdout.strip())
        (metadata_dir / "blue-whale/task-base.json").unlink()
        missing = run(sys.executable, task / "scripts/lib/task_metadata.py", "read",
                      "--worktree", task, "--json", cwd=task, check=False)
        self.assertNotEqual(0, missing.returncode)
        self.assertIn("repair", missing.stderr)
        start_sha = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        bad = run(sys.executable, task / "scripts/lib/task_metadata.py", "repair",
                  "--worktree", task, "--target-branch", "release/2030.01.01_错误发布验证",
                  "--start-sha", start_sha, "--user-authorized", cwd=task, check=False)
        self.assertNotEqual(0, bad.returncode)
        restored = run(sys.executable, task / "scripts/lib/task_metadata.py", "repair",
                       "--worktree", task, "--target-branch", self.release_branch,
                       "--start-sha", start_sha, "--user-authorized", cwd=task, check=False)
        self.assertEqual(0, restored.returncode, restored.stderr)
        conflict = run(sys.executable, task / "scripts/lib/task_metadata.py", "read",
                       "--worktree", task, "--target-branch", "release/2030.01.01_错误发布验证",
                       cwd=task, check=False)
        self.assertNotEqual(0, conflict.returncode)
        self.assertIn("冲突", conflict.stderr)

    def test_remote_ahead_master_is_task_base(self):
        remote_sha = self.commit(
            self.actor, "remote.txt", "remote\n", "feat: 添加远程模块改动"
        )
        run("git", "push", "origin", "HEAD:master", cwd=self.actor)
        result = self.invoke(
            "--type", "feature", "--no-issue", "--summary", "融合远程模块更新"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        task = self.assert_worktree_matches_release()
        self.assertEqual(remote_sha, run("git", "rev-parse", "HEAD", cwd=task).stdout.strip())

    def test_task_base_ignores_local_unpushed_commits(self):
        local_sha = self.commit(
            self.repo, "local.txt", "local\n", "feat: 添加本地模块改动"
        )
        remote_sha = self.commit(
            self.actor, "remote.txt", "remote\n", "feat: 添加远程模块改动"
        )
        run("git", "push", "origin", "HEAD:master", cwd=self.actor)

        result = self.invoke(
            "--type", "feature", "--no-issue", "--summary", "融合本地远程更新"
        )
        self.assertEqual(0, result.returncode, result.stderr)
        task = self.assert_worktree_matches_release()
        task_head = run("git", "rev-parse", "HEAD", cwd=task).stdout.strip()
        self.assertEqual(remote_sha, task_head)
        self.assertNotEqual(local_sha, task_head)

    def test_repo_without_origin_master_fails_closed(self):
        empty = self.root / "empty.git"
        run("git", "init", "--bare", empty, cwd=self.root)
        run("git", "remote", "set-url", "origin", str(empty), cwd=self.repo)
        result = self.invoke(
            "--type", "fix", "--no-issue", "--summary", "处理共享内容冲突"
        )
        self.assertNotEqual(0, result.returncode, result.stderr)
        self.assertEqual(0, len(self.task_worktrees()))

    def test_wrapper_skips_microsoft_store_python3_stub(self):
        store_dir = self.root / "Microsoft" / "WindowsApps"
        store_dir.mkdir(parents=True)
        stub = store_dir / "python3"
        stub.write_text(
            "#!/usr/bin/env bash\n"
            'echo "Python was not found; run from Microsoft Store" >&2\n'
            "exit 9\n",
            encoding="utf-8",
        )
        stub.chmod(0o755)

        env = dict(os.environ)
        env["PATH"] = "{}{}{}".format(store_dir, os.pathsep, env["PATH"])

        result = subprocess.run(
            [BASH, str(self.repo / "scripts/start-task-worktree.sh"),
             "--type", "fix", "--no-issue", "--summary", "跳过桩检测场景",
             "--target-branch", self.release_branch],
            cwd=str(self.repo),
            env=env,
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        self.assertNotEqual(0, result.returncode, result.stderr)
        self.assertIn("桩", result.stderr)
        self.assertNotIn("Python was not found", result.stderr)
        self.assertEqual(0, len(self.task_worktrees()))

    def test_wrapper_falls_back_to_py_launcher_when_python3_is_stub(self):
        real_python3 = shutil.which("python3")
        self.assertIsNotNone(real_python3, "测试机需有真 python3")

        store_dir = self.root / "Microsoft" / "WindowsApps"
        store_dir.mkdir(parents=True)
        stub = store_dir / "python3"
        stub.write_text(
            "#!/usr/bin/env bash\n"
            'echo "Python was not found; run from Microsoft Store" >&2\n'
            "exit 9\n",
            encoding="utf-8",
        )
        stub.chmod(0o755)

        py_dir = self.root / "py-bin"
        py_dir.mkdir()
        fake_py = py_dir / "py"
        fake_py.write_text(
            "#!/usr/bin/env bash\n"
            "shift\n"
            'exec "{real}" "$@"\n'.format(real=real_python3),
            encoding="utf-8",
        )
        fake_py.chmod(0o755)

        env = dict(os.environ)
        env["PATH"] = "{}{}{}{}{}".format(
            store_dir, os.pathsep, py_dir, os.pathsep, env["PATH"]
        )

        result = subprocess.run(
            [BASH, str(self.repo / "scripts/start-task-worktree.sh"),
             "--type", "fix", "--no-issue", "--summary", "回退py启动器场景",
             "--target-branch", self.release_branch],
            cwd=str(self.repo),
            env=env,
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        self.assertEqual(0, result.returncode, result.stderr)
        self.assertNotIn("Python was not found", result.stderr)
        task = self.assert_worktree_matches_release()
        branch = run("git", "branch", "--show-current", cwd=task).stdout.strip()
        self.assertEqual("fix/回退py启动器场景", branch)


if __name__ == "__main__":
    unittest.main()
