#!/usr/bin/env python3
"""Black-box tests for the task-branch synchronization transaction."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

try:  # 作为 scripts.tests.* 命名空间包导入
    from .bash_helper import BASH
except ImportError:  # 经 discover -s scripts/tests 顶层导入
    from bash_helper import BASH


REPO_ROOT = Path(__file__).resolve().parents[2]
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync-task-from-origin.sh"
COMMIT_SCRIPT = REPO_ROOT / "scripts" / "commit-task-for-review.sh"


def run(*args: str, cwd: Path, check: bool = False) -> subprocess.CompletedProcess[str]:
    if args and args[0] == "bash":
        args = (BASH,) + args[1:]
    return subprocess.run(
        list(args),
        cwd=cwd,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=check,
    )


class SyncTaskFromOriginTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.origin = self.root / "origin.git"
        self.main = self.root / "main"
        self.worktree = self.root / "blue-whale-worktrees" / "feature-test"

        run("git", "init", "--bare", str(self.origin), cwd=self.root, check=True)
        run("git", "init", str(self.main), cwd=self.root, check=True)
        run("git", "config", "user.name", "Test User", cwd=self.main, check=True)
        run("git", "config", "user.email", "test@example.com", cwd=self.main, check=True)
        run("git", "config", "commit.gpgsign", "false", cwd=self.main, check=True)
        (self.main / "shared.txt").write_text("base\n", encoding="utf-8")
        run("git", "add", "shared.txt", cwd=self.main, check=True)
        run("git", "commit", "-m", "chore: base", cwd=self.main, check=True)
        run("git", "branch", "-M", "master", cwd=self.main, check=True)
        run("git", "remote", "add", "origin", str(self.origin), cwd=self.main, check=True)
        run("git", "push", "-u", "origin", "master", cwd=self.main, check=True)

        run("git", "branch", "release/prod", cwd=self.main, check=True)
        run("git", "push", "origin", "release/prod", cwd=self.main, check=True)

        run("git", "branch", "feature/测试已有PR更新流程", cwd=self.main, check=True)
        self.worktree.parent.mkdir(parents=True)
        run(
            "git",
            "worktree",
            "add",
            str(self.worktree),
            "feature/测试已有PR更新流程",
            cwd=self.main,
            check=True,
        )
        run("git", "config", "user.name", "Test User", cwd=self.worktree, check=True)
        run("git", "config", "user.email", "test@example.com", cwd=self.worktree, check=True)
        run("git", "config", "commit.gpgsign", "false", cwd=self.worktree, check=True)
        start_sha = self.git("rev-parse", "HEAD")
        git_dir = Path(self.git("rev-parse", "--absolute-git-dir"))
        metadata = git_dir / "blue-whale" / "task-base.json"
        metadata.parent.mkdir(parents=True)
        metadata.write_text(json.dumps({
            "version": 1, "task_branch": "feature/测试已有PR更新流程",
            "target_branch": "release/prod", "start_sha": start_sha,
        }), encoding="utf-8")
        run("git", "checkout", "release/prod", cwd=self.main, check=True)

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def git(self, *args: str, cwd: Path | None = None, check: bool = True) -> str:
        result = run("git", *args, cwd=cwd or self.worktree, check=check)
        return result.stdout.strip()

    def commit_task_change(self, content: str = "task\n") -> str:
        (self.worktree / "task.txt").write_text(content, encoding="utf-8")
        self.git("add", "task.txt")
        self.git("commit", "-m", "feat: task change")
        return self.git("rev-parse", "HEAD")

    def advance_release(self, filename: str = "upstream.txt", content: str = "upstream\n") -> str:
        (self.main / filename).write_text(content, encoding="utf-8")
        self.git("add", filename, cwd=self.main)
        self.git("commit", "-m", "chore: upstream change", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        return self.git("rev-parse", "HEAD", cwd=self.main)

    def invoke(self, *args: str) -> subprocess.CompletedProcess[str]:
        return run("bash", str(SYNC_SCRIPT), *args, cwd=self.worktree)

    def response(self, result: subprocess.CompletedProcess[str]) -> dict[str, object]:
        self.assertTrue(result.stdout.strip(), result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_sync_rebases_onto_origin_release_and_is_idempotent(self) -> None:
        original_head = self.commit_task_change()
        upstream_head = self.advance_release()

        first = self.invoke("sync", "--json")

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(self.response(first)["status"], "SYNCED")
        rebased_head = self.git("rev-parse", "HEAD")
        self.assertNotEqual(rebased_head, original_head)
        self.assertEqual(
            run(
                "git",
                "merge-base",
                "--is-ancestor",
                upstream_head,
                rebased_head,
                cwd=self.worktree,
            ).returncode,
            0,
        )
        git_dir = Path(self.git("rev-parse", "--absolute-git-dir"))
        recovery = json.loads((git_dir / "agent-sync-recovery.json").read_text(encoding="utf-8"))
        self.assertEqual(recovery["original_head"], original_head)
        self.assertEqual(recovery["upstream_sha"], upstream_head)

        second = self.invoke("sync", "--json")

        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.response(second)["status"], "UP_TO_DATE")
        self.assertEqual(self.git("rev-parse", "HEAD"), rebased_head)

    def test_integration_child_rejects_all_independent_sync_actions(self) -> None:
        metadata_path = Path(self.git("rev-parse", "--absolute-git-dir")) / "blue-whale/task-base.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["inherited_sha"] = self.git("rev-parse", "HEAD")
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        original_head = self.git("rev-parse", "HEAD")

        for action in ("sync", "rollback", "finalize"):
            with self.subTest(action=action):
                result = self.invoke(action, "--json")
                self.assertNotEqual(0, result.returncode)
                self.assertIn("整包子票不能独立", self.response(result)["detail"])
                self.assertEqual(original_head, self.git("rev-parse", "HEAD"))

    def test_amend_rejects_release_head_after_zero_commit_sync(self) -> None:
        start_sha = self.git("rev-parse", "HEAD")
        release_head = self.advance_release()
        synced = self.invoke("sync", "--json")
        self.assertEqual(synced.returncode, 0, synced.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), release_head)
        self.assertNotEqual(start_sha, release_head)

        # The commit entry reads its helpers from the task worktree. Copying them
        # after sync leaves the release commit untouched and tests the real CLI.
        (self.worktree / "scripts" / "lib").mkdir(parents=True)
        for name in ("commit-task-for-review.sh",):
            (self.worktree / "scripts" / name).write_bytes((REPO_ROOT / "scripts" / name).read_bytes())
        for name in ("worktree-paths.sh", "python3-command.sh", "task_metadata.py"):
            source = REPO_ROOT / "scripts" / "lib" / name
            (self.worktree / "scripts" / "lib" / name).write_bytes(source.read_bytes())
        (self.worktree / "task.txt").write_text("task\n", encoding="utf-8")
        rejected = run("bash", str(self.worktree / "scripts" / COMMIT_SCRIPT.name),
                       "--amend", cwd=self.worktree)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("尚无自己的 commit", rejected.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), release_head)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.main), release_head)
        self.assertEqual((self.worktree / "task.txt").read_text(encoding="utf-8"), "task\n")

        committed = run("bash", str(self.worktree / "scripts" / COMMIT_SCRIPT.name),
                        "-m", "feat: task change", cwd=self.worktree)
        self.assertEqual(committed.returncode, 0, committed.stderr)
        task_head = self.git("rev-parse", "HEAD")
        self.assertNotEqual(task_head, release_head)
        (self.worktree / "task.txt").write_text("revised\n", encoding="utf-8")
        amended = run("bash", str(self.worktree / "scripts" / COMMIT_SCRIPT.name),
                      "--amend", cwd=self.worktree)
        self.assertEqual(amended.returncode, 0, amended.stderr)
        self.assertNotEqual(self.git("rev-parse", "HEAD"), task_head)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.main), release_head)
        metadata = json.loads((Path(self.git("rev-parse", "--absolute-git-dir")) /
                               "blue-whale/task-base.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["start_sha"], start_sha)

    def test_sync_rebases_onto_release_target(self) -> None:
        original_head = self.commit_task_change()
        release_head = self.advance_release("release-base.txt", "release base\n")

        result = self.invoke("sync", "--target-branch", "release/prod", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = self.response(result)
        self.assertEqual(payload["status"], "SYNCED")
        self.assertEqual(payload["target_branch"], "release/prod")
        self.assertNotEqual(self.git("rev-parse", "HEAD"), original_head)
        self.assertEqual(
            run(
                "git",
                "merge-base",
                "--is-ancestor",
                release_head,
                self.git("rev-parse", "HEAD"),
                cwd=self.worktree,
            ).returncode,
            0,
        )
        recovery = json.loads(
            (Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(recovery["target_branch"], "release/prod")

    def test_sync_refuses_local_baseline_not_shared_to_remote_release(self) -> None:
        (self.main / "local-baseline.txt").write_text("local\n", encoding="utf-8")
        self.git("add", "local-baseline.txt", cwd=self.main)
        self.git("commit", "-m", "chore: local release baseline", cwd=self.main)
        local_start = self.git("rev-parse", "HEAD", cwd=self.main)
        self.git("merge", "--ff-only", "release/prod")
        metadata_path = Path(self.git("rev-parse", "--absolute-git-dir")) / "blue-whale" / "task-base.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["start_sha"] = local_start
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
        task_head = self.commit_task_change()

        result = self.invoke("sync", "--json")

        self.assertEqual(result.returncode, 1)
        self.assertIn("local release baseline", str(self.response(result)["detail"]))
        self.assertEqual(self.git("rev-parse", "HEAD"), task_head)
        self.assertFalse((metadata_path.parent.parent / "agent-sync-recovery.json").exists())

    def test_sync_rejects_unprotected_target(self) -> None:
        result = self.invoke("sync", "--target-branch", "develop", "--json")

        self.assertEqual(result.returncode, 1)
        self.assertIn("目标", str(self.response(result)["detail"]))

    def test_sync_aborts_conflict_and_reports_decision_evidence(self) -> None:
        (self.worktree / "shared.txt").write_text("task side\n", encoding="utf-8")
        self.git("add", "shared.txt")
        self.git("commit", "-m", "fix: task edits shared line")
        original_head = self.git("rev-parse", "HEAD")
        upstream_head = self.advance_release("shared.txt", "upstream side\n")

        result = self.invoke("sync", "--json")

        self.assertEqual(result.returncode, 3, result.stderr)
        payload = self.response(result)
        self.assertEqual(payload["status"], "REBASE_CONFLICT_ABORTED")
        self.assertEqual(payload["original_head"], original_head)
        self.assertEqual(payload["upstream_sha"], upstream_head)
        self.assertEqual(payload["replaying_commit"], original_head)
        self.assertEqual(payload["conflict_files"], ["shared.txt"])
        self.assertEqual(self.git("rev-parse", "HEAD"), original_head)
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.assertTrue(Path(str(payload["recovery_file"])).exists())

    def test_sync_keeps_conflict_for_review_and_verifies_resolved_tree(self) -> None:
        (self.worktree / "shared.txt").write_text("task side\n", encoding="utf-8")
        self.git("add", "shared.txt")
        self.git("commit", "-m", "fix: task edits shared line")
        original = self.git("rev-parse", "HEAD")
        self.advance_release("shared.txt", "upstream side\n")

        conflicted = self.invoke("sync", "--keep-conflicts", "--json")
        self.assertEqual(conflicted.returncode, 3, conflicted.stderr)
        self.assertEqual(self.response(conflicted)["status"], "REBASE_CONFLICT_ACTIVE")
        self.assertTrue(Path(self.git("rev-parse", "--git-path", "rebase-merge")).exists())
        (self.worktree / "shared.txt").write_text("upstream side\ntask side\n", encoding="utf-8")
        self.git("add", "shared.txt")
        continued = run("git", "-c", "core.editor=true", "rebase", "--continue",
                        cwd=self.worktree)
        self.assertEqual(continued.returncode, 0, continued.stderr)

        completed = self.invoke("complete-resolved", "--json")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(self.response(completed)["status"], "SYNCED_RESOLVED")
        self.assertEqual((self.worktree / "shared.txt").read_text(encoding="utf-8"),
                         "upstream side\ntask side\n")
        recovery = json.loads((Path(self.git("rev-parse", "--absolute-git-dir")) /
                               "agent-sync-recovery.json").read_text(encoding="utf-8"))
        self.assertEqual(recovery["rebase_input_head"], original)
        self.assertEqual(recovery["rebase_resolved_files"], ["shared.txt"])
        again = self.invoke("sync", "--json")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(self.response(again)["status"], "UP_TO_DATE")

    def test_resolved_sync_rejects_changes_outside_conflict(self) -> None:
        (self.worktree / "shared.txt").write_text("task side\n", encoding="utf-8")
        self.git("add", "shared.txt")
        self.git("commit", "-m", "fix: task edits shared line")
        self.advance_release("shared.txt", "upstream side\n")
        self.assertEqual(self.invoke("sync", "--keep-conflicts", "--json").returncode, 3)
        (self.worktree / "shared.txt").write_text("upstream side\ntask side\n", encoding="utf-8")
        self.git("add", "shared.txt")
        self.assertEqual(run("git", "-c", "core.editor=true", "rebase", "--continue",
                             cwd=self.worktree).returncode, 0)
        (self.worktree / "unrelated.txt").write_text("unexpected\n", encoding="utf-8")
        self.git("add", "unrelated.txt")
        self.git("commit", "-m", "chore: unrelated change")

        blocked = self.invoke("complete-resolved", "--json")
        self.assertEqual(blocked.returncode, 4)
        self.assertEqual(self.response(blocked)["status"], "VERIFICATION_FAILED")
        self.assertIn("unrelated.txt", self.response(blocked)["resolved_files"])

    def test_rollback_restores_original_head_and_removes_recovery_point(self) -> None:
        original_head = self.commit_task_change()
        self.advance_release()
        synced = self.invoke("sync", "--json")
        self.assertEqual(synced.returncode, 0, synced.stderr)
        synced_payload = self.response(synced)
        self.assertNotEqual(self.git("rev-parse", "HEAD"), original_head)

        result = self.invoke("rollback", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.response(result)["status"], "ROLLED_BACK")
        self.assertEqual(self.git("rev-parse", "HEAD"), original_head)
        self.assertFalse(Path(str(synced_payload["recovery_file"])).exists())
        self.assertNotEqual(
            run(
                "git",
                "show-ref",
                "--verify",
                str(synced_payload["backup_ref"]),
                cwd=self.worktree,
            ).returncode,
            0,
        )

    def test_finalize_rejects_recovery_point_that_has_not_been_pushed(self) -> None:
        self.commit_task_change()
        self.advance_release()
        synced = self.invoke("sync", "--json")
        self.assertEqual(synced.returncode, 0, synced.stderr)
        synced_payload = self.response(synced)
        synced_head = self.git("rev-parse", "HEAD")

        result = self.invoke("finalize", "--json")

        self.assertEqual(result.returncode, 1)
        payload = self.response(result)
        self.assertEqual(payload["status"], "ERROR")
        self.assertIn("尚未推送", str(payload["detail"]))
        self.assertEqual(self.git("rev-parse", "HEAD"), synced_head)
        self.assertTrue(Path(str(synced_payload["recovery_file"])).exists())
        self.assertEqual(
            run(
                "git",
                "show-ref",
                "--verify",
                str(synced_payload["backup_ref"]),
                cwd=self.worktree,
            ).returncode,
            0,
        )

    def test_finalize_rejects_dirty_worktree_and_preserves_recovery(self) -> None:
        self.commit_task_change()
        self.advance_release()
        synced = self.invoke("sync", "--json")
        payload = self.response(synced)
        marker = Path(str(payload["recovery_file"]))
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        head = self.git("rev-parse", "HEAD")
        recovery.update(push_state="pushed", pushed_head=head, verified_head=head)
        marker.write_text(json.dumps(recovery), encoding="utf-8")
        (self.worktree / "dirty.txt").write_text("dirty\n", encoding="utf-8")

        result = self.invoke("finalize", "--json")

        self.assertEqual(result.returncode, 1)
        self.assertIn("不干净", str(self.response(result)["detail"]))
        self.assertTrue(marker.exists())

    def test_finalize_preserves_recovery_when_backup_ref_cannot_be_deleted(self) -> None:
        self.commit_task_change()
        self.advance_release()
        synced = self.invoke("sync", "--json")
        payload = self.response(synced)
        marker = Path(str(payload["recovery_file"]))
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        head = self.git("rev-parse", "HEAD")
        recovery.update(push_state="pushed", pushed_head=head, verified_head=head)
        marker.write_text(json.dumps(recovery), encoding="utf-8")
        common = Path(self.git("rev-parse", "--git-common-dir"))
        if not common.is_absolute():
            common = (self.worktree / common).resolve()
        lock = common / (str(payload["backup_ref"]) + ".lock")
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text("locked", encoding="utf-8")

        result = self.invoke("finalize", "--json")

        self.assertEqual(result.returncode, 1)
        self.assertIn("backup ref", str(self.response(result)["detail"]))
        self.assertTrue(marker.exists())

    def test_sync_rejects_non_structured_ascii_branch(self) -> None:
        self.git("branch", "-m", "feature/ascii-name")

        result = self.invoke("sync", "--json")

        self.assertEqual(result.returncode, 1)
        payload = self.response(result)
        self.assertEqual(payload["status"], "ERROR")
        self.assertIn("结构化", str(payload["detail"]))

    def test_sync_accepts_legacy_gbk_polluted_recovery_branch_field(self) -> None:
        original_head = self.commit_task_change()
        self.advance_release()
        git_dir = Path(self.git("rev-parse", "--absolute-git-dir"))
        branch = "feature/测试已有PR更新流程"
        # 模拟 PR577 前旧版脚本污染：真实分支名 UTF-8 字节按 GBK 解码得到的乱码 str，
        # 再经 ensure_ascii=False 写文件（utf-8 编码）——即恢复点 branch 字段实际形态。
        polluted = branch.encode("utf-8").decode("gbk")
        marker = git_dir / "agent-sync-recovery.json"
        marker.write_text(
            json.dumps(
                {
                    "version": 1,
                    "branch": polluted,
                    "original_head": original_head,
                    "upstream_sha": self.git("rev-parse", "HEAD"),
                    "target_branch": "release/prod",
                    "remote_branch_sha": "",
                    "backup_ref": "refs/agent-sync-backups/{}/{}".format(
                        "feature", "测试已有PR更新流程"
                    ),
                    "created_at": 0,
                }
            ),
            encoding="utf-8",
        )

        result = self.invoke("sync", "--json")

        # 旧乱码恢复点不再误判「属于其他分支」；应正常开启同步事务。
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = self.response(result)
        self.assertEqual(payload["status"], "SYNCED")
        self.assertTrue(marker.exists())
        # branch 字段应在同步事务中被归一化为实时真实 UTF-8 名，供下游严格比较使用。
        recovery_after = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(recovery_after["branch"], branch)

    def test_sync_records_existing_remote_source_sha_and_private_marker_mode(self) -> None:
        original_head = self.commit_task_change()
        self.git("push", "-u", "origin", "HEAD")
        self.advance_release()

        result = self.invoke("sync", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = self.response(result)
        self.assertEqual(payload["remote_branch_sha"], original_head)
        marker = Path(str(payload["recovery_file"]))
        # Windows 无 POSIX 权限位（os.chmod 0600 后 st_mode 仍 0o666），
        # 恢复点私密性改由 ACL 收紧实现：断言仅属主有权，其余（BUILTIN\Users）被拒。
        if os.name == "nt":
            acl = subprocess.run(
                ["icacls", str(marker)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            self.assertEqual(acl.returncode, 0, acl.stderr)
            # 收紧后的 ACL 不得含 BUILTIN\Users 条目；注意区分路径本身的 \Users\<name>。
            self.assertNotRegex(acl.stdout, r"BUILTIN[\\/]Users")
        else:
            self.assertEqual(marker.stat().st_mode & 0o777, 0o600)

    def test_recovery_atomic_write_failure_returns_structured_error(self) -> None:
        original_head = self.commit_task_change()
        self.advance_release()
        git_dir = Path(self.git("rev-parse", "--absolute-git-dir"))
        blocked_temporary = git_dir / "agent-sync-recovery.json.tmp"
        blocked_temporary.mkdir()

        result = self.invoke("sync", "--json")

        self.assertEqual(result.returncode, 1)
        payload = self.response(result)
        self.assertEqual(payload["status"], "ERROR")
        self.assertIn("原子写入", str(payload["detail"]))
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), original_head)

    def test_repeated_sync_preserves_the_original_transaction_recovery_head(self) -> None:
        original_head = self.commit_task_change()
        self.advance_release("upstream-one.txt", "one\n")
        first = self.invoke("sync", "--json")
        self.assertEqual(first.returncode, 0, first.stderr)

        self.advance_release("upstream-two.txt", "two\n")
        second = self.invoke("sync", "--json")

        self.assertEqual(second.returncode, 0, second.stderr)
        payload = self.response(second)
        marker = Path(str(payload["recovery_file"]))
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(recovery["original_head"], original_head)

        rollback = self.invoke("rollback", "--json")

        self.assertEqual(rollback.returncode, 0, rollback.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD"), original_head)

    def test_sync_accepts_linear_commits_after_pending_rebase(self) -> None:
        child_head = self.commit_task_change()
        child = self.root / "blue-whale-worktrees" / "child"
        self.git("worktree", "add", "-b", "feature/child", str(child), child_head)
        child_git_dir = Path(self.git("rev-parse", "--absolute-git-dir", cwd=child))
        child_metadata = child_git_dir / "blue-whale" / "task-base.json"
        child_metadata.parent.mkdir(parents=True)
        child_metadata.write_text(json.dumps({
            "version": 1, "task_branch": "feature/child",
            "target_branch": "release/prod", "start_sha": child_head,
        }), encoding="utf-8")
        (self.worktree / "integration.txt").write_text("integration\n", encoding="utf-8")
        self.git("add", "integration.txt")
        self.git("commit", "-m", "fix: integration followup")
        original_head = self.git("rev-parse", "HEAD")
        self.advance_release("upstream-one.txt", "one\n")
        first = self.invoke("sync", "--json")
        self.assertEqual(first.returncode, 0, first.stderr)
        first_synced = self.git("rev-parse", "HEAD")

        (self.worktree / "review.txt").write_text("review\n", encoding="utf-8")
        self.git("add", "review.txt")
        self.git("commit", "-m", "fix: review change")
        review_head = self.git("rev-parse", "HEAD")
        up_to_date = self.invoke("sync", "--json")
        self.assertEqual(up_to_date.returncode, 0, up_to_date.stderr)
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["synced_head"], review_head)
        self.assertNotEqual(self.invoke("rollback", "--json").returncode, 0)

        self.advance_release("upstream-two.txt", "two\n")
        second = self.invoke("sync", "--json")
        self.assertEqual(second.returncode, 0, second.stderr)
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(recovery["original_head"], original_head)
        self.assertEqual(recovery["rebase_proofs"][0]["synced_head"], first_synced)
        self.assertEqual(recovery["rebase_proofs"][0]["original_head"], original_head)
        self.assertEqual(recovery["rebase_input_head"], review_head)
        self.assertEqual((self.worktree / "review.txt").read_text(encoding="utf-8"), "review\n")

        second_head = self.git("rev-parse", "HEAD")
        self.advance_release("upstream-three.txt", "three\n")
        third = self.invoke("sync", "--json")
        self.assertEqual(third.returncode, 0, third.stderr)
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(len(recovery["rebase_proofs"]), 2)
        self.assertEqual(recovery["rebase_proofs"][1]["original_head"], review_head)
        self.assertEqual(recovery["rebase_input_head"], second_head)

    def test_sync_rejects_merge_commit_after_pending_rebase(self) -> None:
        self.commit_task_change()
        self.advance_release()
        first = self.invoke("sync", "--json")
        self.assertEqual(first.returncode, 0, first.stderr)
        marker = Path(str(self.response(first)["recovery_file"]))
        before = marker.read_bytes()

        self.git("switch", "-c", "fix/side")
        (self.worktree / "side.txt").write_text("side\n", encoding="utf-8")
        self.git("add", "side.txt")
        self.git("commit", "-m", "fix: side")
        self.git("switch", "feature/测试已有PR更新流程")
        self.git("merge", "--no-ff", "fix/side", "-m", "merge: side")
        result = self.invoke("sync", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("merge commit", str(self.response(result)["detail"]))
        self.assertEqual(marker.read_bytes(), before)

    def test_sync_rejects_remote_source_change_after_pending_rebase(self) -> None:
        self.commit_task_change()
        self.advance_release()
        first = self.invoke("sync", "--json")
        self.assertEqual(first.returncode, 0, first.stderr)
        marker = Path(str(self.response(first)["recovery_file"]))
        before = marker.read_bytes()
        self.git("push", "origin", "HEAD:refs/heads/feature/测试已有PR更新流程")
        self.advance_release("upstream-two.txt", "two\n")

        result = self.invoke("sync", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("远端源分支变化", str(self.response(result)["detail"]))
        self.assertEqual(marker.read_bytes(), before)

    def test_linearized_pr_rejects_rename_outside_frozen_diff(self) -> None:
        self.advance_release("a", "same\n")
        self.advance_release("x", "same\n")
        self.git("merge", "--ff-only", "release/prod")
        (self.worktree / "a").unlink()
        self.git("add", "a")
        self.git("commit", "-m", "fix: delete a")
        self.advance_release("upstream.txt", "upstream\n")
        first = self.invoke("sync", "--json")
        self.assertEqual(first.returncode, 0, first.stderr)
        marker = Path(str(self.response(first)["recovery_file"]))
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        recovery.update(linearized_pr=123, frozen_files=["a"])
        marker.write_text(json.dumps(recovery), encoding="utf-8")
        synced_head = self.git("rev-parse", "HEAD")

        self.git("mv", "x", "a")
        self.git("commit", "-m", "fix: rename x to a")
        self.assertEqual(self.git("diff", "--name-only", f"{synced_head}..HEAD"), "a")
        self.assertEqual(self.git("diff", "--name-only", "origin/release/prod...HEAD"), "x")
        before = marker.read_bytes()

        result = self.invoke("sync", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("冻结文件范围", str(self.response(result)["detail"]))
        self.assertEqual(marker.read_bytes(), before)

        self.advance_release("upstream-two.txt", "two\n")
        result = self.invoke("sync", "--json")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("冻结文件范围", str(self.response(result)["detail"]))
        self.assertEqual(marker.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
