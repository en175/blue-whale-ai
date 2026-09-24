#!/usr/bin/env python3
"""Black-box tests for explicit create/update publication modes."""

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

try:  # 作为 scripts.tests.* 命名空间包导入
    from .bash_helper import BASH
except ImportError:  # 经 discover -s scripts/tests 顶层导入
    from bash_helper import BASH


REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLISH_SCRIPT = REPO_ROOT / "scripts" / "publish-review-package.sh"
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync-task-from-origin.sh"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify-pr-update.sh"
CREATE_PR_HOOK = REPO_ROOT / ".claude" / "hooks" / "confirm-release-action.sh"
BRANCH = "feature/测试已有PR更新流程"


def run(*args: str, cwd: Path, check: bool = False) -> subprocess.CompletedProcess[str]:
    if args and args[0] == "bash":
        args = (BASH,) + args[1:]
    return subprocess.run(
        list(args), cwd=cwd, text=True, encoding="utf-8", capture_output=True, check=check
    )


class PublishReviewPackageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.origin = self.root / "origin.git"
        self.main = self.root / "main"
        self.worktree = self.root / "blue-whale-worktrees" / "feature-test"
        self.real_node = shutil.which("node") or "/usr/bin/node"
        self.fake_bin = self.root / "fake-verification-bin"
        self.fake_bin.mkdir()
        self.verification_log = self.root / "verification-args.log"
        fake_node = self.fake_bin / "node"
        fake_node.write_text(
            "#!/bin/sh\n"
            "case \"$1\" in\n"
            "  */scripts/verify-change-scope.mjs) printf '%s\\n' \"$*\" >> \"$VERIFICATION_LOG\"; exit 0 ;;\n"
            "esac\n"
            "exec \"$REAL_NODE\" \"$@\"\n",
            encoding="utf-8",
        )
        fake_node.chmod(0o755)
        self.base_env = os.environ.copy()
        # os.pathsep：POSIX 为 ":"（行为与原来一致）；Windows 为 ";"。
        # 若在 Git Bash 下用 ":" 拼接 Windows 盘符路径，MSYS 会把 `C:\...` 拦腰
        # 拆成 "C" + 相对路径，导致 fake-verification-bin 从 PATH 中消失，
        # 真实 node 顶替运行 verify-change-scope.mjs（rc 11）。
        self.base_env["PATH"] = str(self.fake_bin) + os.pathsep + self.base_env["PATH"]
        self.base_env["REAL_NODE"] = self.real_node
        self.base_env["VERIFICATION_LOG"] = str(self.verification_log)
        run("git", "init", "--bare", str(self.origin), cwd=self.root, check=True)
        run("git", "init", str(self.main), cwd=self.root, check=True)
        self.configure(self.main)
        (self.main / "base.txt").write_text("base\n", encoding="utf-8")
        self.git("add", "base.txt", cwd=self.main)
        self.git("commit", "-m", "chore: base", cwd=self.main)
        self.git("branch", "-M", "master", cwd=self.main)
        self.git("remote", "add", "origin", str(self.origin), cwd=self.main)
        self.git("push", "-u", "origin", "master", cwd=self.main)
        self.git("branch", "release/prod", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        self.git("branch", BRANCH, cwd=self.main)
        self.worktree.parent.mkdir(parents=True)
        self.git("worktree", "add", str(self.worktree), BRANCH, cwd=self.main)
        self.configure(self.worktree)
        start_sha = self.git("rev-parse", "HEAD")
        metadata = Path(self.git("rev-parse", "--absolute-git-dir")) / "blue-whale" / "task-base.json"
        metadata.parent.mkdir(parents=True)
        metadata.write_text(json.dumps({
            "version": 1, "task_branch": BRANCH,
            "target_branch": "release/prod", "start_sha": start_sha,
        }), encoding="utf-8")
        self.git("checkout", "release/prod", cwd=self.main)
        self.commit_followup("initial task")

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def configure(self, repo: Path) -> None:
        run("git", "config", "user.name", "Test User", cwd=repo, check=True)
        run("git", "config", "user.email", "test@example.com", cwd=repo, check=True)
        run("git", "config", "commit.gpgsign", "false", cwd=repo, check=True)
        run("git", "config", "core.hooksPath", "/dev/null", cwd=repo, check=True)

    def git(self, *args: str, cwd: Path | None = None, check: bool = True) -> str:
        result = run("git", *args, cwd=cwd or self.worktree, check=check)
        return result.stdout.strip()

    def commit_followup(self, content: str) -> str:
        (self.worktree / "task.txt").write_text(content + "\n", encoding="utf-8")
        self.git("add", "task.txt")
        self.git("commit", "-m", "fix: review follow-up")
        return self.git("rev-parse", "HEAD")

    def publish_marker(self) -> Path:
        common = Path(self.git("rev-parse", "--git-common-dir"))
        if not common.is_absolute():
            common = (self.worktree / common).resolve()
        return common / "agent-release-review-package-feature%测试已有PR更新流程"

    def invoke(self, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [BASH, str(PUBLISH_SCRIPT), *args],
            cwd=self.worktree,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            env=env or self.base_env,
        )

    def invoke_create_pr_hook(self, *, enterprise_id=None, project_id=None,
                              source_repo=None) -> subprocess.CompletedProcess[str]:
        payload = {"tool_name": "mcp__gitee-ent__create_enterprise_repo_pull", "tool_input": {
            "source_branch": BRANCH, "target_branch": "release/prod", "draft": False,
        }}
        if enterprise_id is not None:
            payload["tool_input"]["enterprise_id"] = enterprise_id
        if project_id is not None:
            payload["tool_input"]["project_id"] = project_id
        if source_repo is not None:
            payload["tool_input"]["source_repo"] = source_repo
        return subprocess.run(
            [BASH, str(CREATE_PR_HOOK)], cwd=self.worktree,
            input=json.dumps(payload), text=True, encoding="utf-8", capture_output=True,
            env={**self.base_env, "CLAUDE_PROJECT_DIR": str(self.worktree)},
        )

    def pr_snapshot(
        self,
        *,
        iid: object = 65,
        state: str = "opened",
        source_branch: str = BRANCH,
        target_branch: str = "release/prod",
        head_sha: str | None = None,
        conflict: bool = False,
        changed_files: list[str] | None = None,
    ) -> Path:
        if head_sha is None:
            line = self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH))
            head_sha = line.split()[0] if line else ""
        if changed_files is None and head_sha:
            changed = self.git(
                "diff", "--name-only", "origin/{}...{}".format(target_branch, head_sha)
            )
            changed_files = changed.splitlines() if changed else []
        path = self.root / "pr-snapshot-{}.json".format(time.time_ns())
        path.write_text(
            json.dumps(
                {
                    "pull_request_id": iid,
                    "state": state,
                    "source_branch": source_branch,
                    "target_branch": target_branch,
                    "head_sha": head_sha,
                    "conflict": conflict,
                    "changed_files": changed_files or [],
                    "fetched_at": int(time.time()),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        path.chmod(0o600)
        return path

    def invoke_update(
        self, snapshot: Path | None = None, *extra: str, env: dict[str, str] | None = None
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                BASH,
                str(PUBLISH_SCRIPT),
                "--user-authorized",
                "--update-pr",
                "65",
                "--pr-snapshot",
                str(snapshot or self.pr_snapshot()),
                *extra,
                "--json",
            ],
            cwd=self.worktree,
            text=True,
            encoding="utf-8",
            capture_output=True,
            env=env or self.base_env,
        )

    def response(self, result: subprocess.CompletedProcess[str]) -> dict[str, object]:
        self.assertTrue(result.stdout.strip(), result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_missing_mode_fails_closed(self) -> None:
        result = self.invoke("--user-authorized", "--json")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_MODE")

    def test_create_and_update_modes_are_mutually_exclusive(self) -> None:
        result = self.invoke("--user-authorized", "--create-pr", "--update-pr", "65", "--json")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_MODE")

    def test_update_mode_rejects_invalid_pr_iid(self) -> None:
        result = self.invoke("--user-authorized", "--update-pr", "not-a-number", "--json")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_PR_IID")

    def test_update_mode_requires_gitee_pr_snapshot(self) -> None:
        result = self.invoke("--user-authorized", "--update-pr", "65", "--json")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "PR_SNAPSHOT_REQUIRED")

    def test_create_mode_pushes_and_writes_create_marker(self) -> None:
        expected_head = self.git("rev-parse", "HEAD")

        result = self.invoke("--user-authorized", "--create-pr", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = self.response(result)
        self.assertEqual(payload["status"], "PUSHED_CREATE_PR")
        self.assertEqual(payload["head"], expected_head)
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            expected_head,
        )
        self.assertTrue(self.publish_marker().exists())
        marker = self.publish_marker().read_text(encoding="utf-8")
        self.assertIn("draft=false", marker)
        self.assertIn(f"head={expected_head}", marker)
        target_sha = self.git("ls-remote", "--heads", "origin", "refs/heads/release/prod").split()[0]
        self.assertIn(f"target_sha={target_sha}", marker)

    def test_create_mode_can_bind_an_explicit_draft_marker(self) -> None:
        result = self.invoke("--user-authorized", "--create-pr", "--draft-pr", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("draft=true", self.publish_marker().read_text(encoding="utf-8"))

    def test_create_pr_hook_rejects_source_commit_after_marker(self) -> None:
        created = self.invoke("--user-authorized", "--create-pr", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        self.assertEqual(0, self.invoke_create_pr_hook().returncode)
        self.commit_followup("after marker")
        self.git("push", "origin", f"HEAD:refs/heads/{BRANCH}")

        blocked = self.invoke_create_pr_hook()

        self.assertEqual(2, blocked.returncode)
        self.assertIn("源分支", blocked.stderr)

    def test_create_pr_hook_rejects_target_advance_after_marker(self) -> None:
        created = self.invoke("--user-authorized", "--create-pr", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        self.assertEqual(0, self.invoke_create_pr_hook().returncode)
        self.git("commit", "--allow-empty", "-m", "chore: advance target", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)

        blocked = self.invoke_create_pr_hook()

        self.assertEqual(2, blocked.returncode)
        self.assertIn("目标分支", blocked.stderr)

    def test_create_pr_hook_rejects_other_repository_scope(self) -> None:
        created = self.invoke("--user-authorized", "--create-pr", "--json")
        self.assertEqual(0, created.returncode, created.stderr)

        same_repository = self.invoke_create_pr_hook(enterprise_id=16660949, project_id=48854568)
        other_project = self.invoke_create_pr_hook(project_id=123456)
        other_enterprise = self.invoke_create_pr_hook(enterprise_id=123456)
        other_source = self.invoke_create_pr_hook(source_repo="123456")

        self.assertEqual(0, same_repository.returncode, same_repository.stderr)
        self.assertEqual(2, other_project.returncode)
        self.assertIn("project_id", other_project.stderr)
        self.assertEqual(2, other_enterprise.returncode)
        self.assertIn("enterprise_id", other_enterprise.stderr)
        self.assertEqual(2, other_source.returncode)
        self.assertIn("source_repo", other_source.stderr)

    def test_update_mode_rejects_draft_creation_flag(self) -> None:
        result = self.invoke_update(self.pr_snapshot(), "--draft-pr")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_ARGUMENT")

    def test_create_mode_reports_needs_sync_under_utf8_locale(self) -> None:
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        env = self.base_env.copy()
        env["LC_ALL"] = "C.UTF-8"

        result = self.invoke("--user-authorized", "--create-pr", "--json", env=env)

        self.assertEqual(result.returncode, 10, result.stderr)
        self.assertEqual(self.response(result)["status"], "NEEDS_SYNC")

    def test_create_mode_supports_release_target_and_binds_marker(self) -> None:
        result = self.invoke(
            "--user-authorized",
            "--create-pr",
            "--target-branch",
            "release/prod",
            "--json",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("target=release/prod", self.publish_marker().read_text(encoding="utf-8"))
        self.assertIn("check --stage pr --json", self.verification_log.read_text(encoding="utf-8"))

    def test_create_mode_rejects_unprotected_target(self) -> None:
        for target in ("develop", "release/"):
            with self.subTest(target=target):
                result = self.invoke(
                    "--user-authorized", "--create-pr", "--target-branch", target, "--json"
                )

                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.response(result)["status"], "INVALID_TARGET_BRANCH")

    def test_update_mode_reads_release_target_from_snapshot(self) -> None:
        self.git("push", "-u", "origin", "HEAD")
        expected_head = self.commit_followup("release review follow-up")

        result = self.invoke_update(self.pr_snapshot(target_branch="release/prod"))

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.response(result)["head"], expected_head)
        self.assertIn("check --stage pr --json", self.verification_log.read_text(encoding="utf-8"))

    def test_update_mode_rejects_snapshot_target_outside_task_metadata(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("review fix")
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)

        result = self.invoke_update(
            self.pr_snapshot(target_branch="release/other", head_sha=remote_head,
                             changed_files=["task.txt"])
        )

        self.assertEqual(result.returncode, 12)
        self.assertEqual(self.response(result)["status"], "TASK_BASE_INVALID")

    def test_update_mode_rejects_explicit_target_even_when_master(self) -> None:
        result = self.invoke_update(self.pr_snapshot(), "--target-branch", "master")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_TARGET_BRANCH")

    def test_update_mode_requires_existing_remote_source_branch(self) -> None:
        result = self.invoke_update(self.pr_snapshot(head_sha=""))

        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.response(result)["status"], "REMOTE_SOURCE_MISSING")
        self.assertFalse(self.publish_marker().exists())

    def test_update_mode_pushes_with_lease_without_create_marker(self) -> None:
        self.git("push", "-u", "origin", "HEAD")
        expected_head = self.commit_followup("second follow-up")

        result = self.invoke_update()

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = self.response(result)
        self.assertEqual(payload["status"], "PUSHED_UPDATE_PR")
        self.assertEqual(payload["pull_request_id"], 65)
        self.assertEqual(payload["head"], expected_head)
        self.assertEqual(payload["merge_commit_count"], 0)
        self.assertIn("task.txt", payload["changed_files"])
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            expected_head,
        )
        self.assertFalse(self.publish_marker().exists())

    def test_update_mode_rejects_task_branch_merge_commits(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        self.git("branch", "feature/其他工单")
        self.git("checkout", "feature/其他工单")
        (self.worktree / "unrelated.txt").write_text("unrelated\n", encoding="utf-8")
        self.git("add", "unrelated.txt")
        self.git("commit", "-m", "feat: unrelated task")
        self.git("checkout", BRANCH)
        self.git("merge", "--no-ff", "feature/其他工单", "-m", "chore: merge unrelated task")

        result = self.invoke_update()

        self.assertEqual(result.returncode, 6)
        payload = self.response(result)
        self.assertEqual(payload["status"], "SCOPE_MERGE_COMMIT_DETECTED")
        self.assertGreater(payload["merge_commit_count"], 0)
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            remote_head,
        )

    def test_update_mode_rejects_unknown_remote_change_after_sync_snapshot(self) -> None:
        remote_before = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("local review fix")
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)

        attacker = self.root / "attacker"
        run("git", "clone", str(self.origin), str(attacker), cwd=self.root, check=True)
        self.configure(attacker)
        self.git("checkout", "-b", BRANCH, "origin/{}".format(BRANCH), cwd=attacker)
        (attacker / "remote.txt").write_text("other writer\n", encoding="utf-8")
        self.git("add", "remote.txt", cwd=attacker)
        self.git("commit", "-m", "fix: concurrent remote update", cwd=attacker)
        self.git("push", "origin", BRANCH, cwd=attacker)

        result = self.invoke_update(self.pr_snapshot(head_sha=remote_before))

        self.assertEqual(result.returncode, 5)
        payload = self.response(result)
        self.assertEqual(payload["status"], "REMOTE_LEASE_CHANGED")
        self.assertEqual(payload["expected_remote_sha"], remote_before)
        self.assertNotEqual(payload["actual_remote_sha"], remote_before)

    def test_successful_update_prevents_local_rollback_until_remote_is_adjudicated(self) -> None:
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("local review fix")
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)
        published = self.invoke_update()
        self.assertEqual(published.returncode, 0, published.stderr)

        rollback = run("bash", str(SYNC_SCRIPT), "rollback", "--json", cwd=self.worktree)

        self.assertEqual(rollback.returncode, 1)
        payload = self.response(rollback)
        self.assertEqual(payload["status"], "ERROR")
        self.assertIn("推送", str(payload["detail"]))

        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)

        self.assertEqual(finalized.returncode, 1)
        self.assertIn("远端核验", str(self.response(finalized)["detail"]))

        verified = run(
            "bash",
            str(VERIFY_SCRIPT),
            "--update-pr",
            "65",
            "--pr-snapshot",
            str(self.pr_snapshot(head_sha=self.git("rev-parse", "HEAD"))),
            "--json",
            cwd=self.worktree,
        )
        self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertEqual(self.response(verified)["status"], "PR_UPDATE_VERIFIED")

        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)

        self.assertEqual(finalized.returncode, 0, finalized.stderr)
        self.assertEqual(self.response(finalized)["status"], "FINALIZED")

    def test_pr_identity_is_verified_before_push(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("review fix")
        snapshot = self.pr_snapshot(iid=999, head_sha=remote_head)

        result = self.invoke_update(snapshot)

        self.assertEqual(result.returncode, 8)
        self.assertEqual(self.response(result)["status"], "PR_EVIDENCE_INVALID")
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            remote_head,
        )

    def test_malformed_pr_iid_still_returns_structured_json(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("review fix")
        for malformed in (None, [], {}):
            with self.subTest(pull_request_id=malformed):
                result = self.invoke_update(self.pr_snapshot(iid=malformed, head_sha=remote_head))
                self.assertEqual(result.returncode, 8)
                self.assertEqual(self.response(result)["status"], "PR_EVIDENCE_INVALID")

    def test_closed_or_misbound_pr_is_rejected_before_push(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("review fix")
        cases = (
            {"state": "closed"},
            {"source_branch": "feature/其他分支"},
            {"target_branch": "develop", "changed_files": ["task.txt"]},
        )
        for overrides in cases:
            with self.subTest(overrides=overrides):
                snapshot = self.pr_snapshot(head_sha=remote_head, **overrides)
                result = self.invoke_update(snapshot)
                self.assertEqual(result.returncode, 8)
                self.assertEqual(self.response(result)["status"], "PR_EVIDENCE_INVALID")
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            remote_head,
        )

    def test_scope_snapshot_rejects_unapproved_new_file_before_push(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        (self.worktree / "unrelated.txt").write_text("unrelated\n", encoding="utf-8")
        self.git("add", "unrelated.txt")
        self.git("commit", "-m", "feat: unrelated linear change")
        snapshot = self.pr_snapshot(head_sha=remote_head, changed_files=["task.txt"])

        result = self.invoke_update(snapshot)

        self.assertEqual(result.returncode, 8)
        self.assertIn("冻结范围外", str(self.response(result)["detail"]))
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            remote_head,
        )

    def test_remote_read_failure_returns_structured_status(self) -> None:
        self.git("remote", "set-url", "origin", str(self.root / "missing-origin.git"))

        result = self.invoke("--user-authorized", "--create-pr", "--json")

        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(self.response(result)["status"], "REMOTE_READ_FAILED")

    def test_ls_remote_failure_returns_structured_status(self) -> None:
        real_git = shutil.which("git") or "/usr/bin/git"
        fake_bin = self.root / "fake-ls-remote-bin"
        fake_bin.mkdir()
        fake_git = fake_bin / "git"
        fake_git.write_text(
            "#!/bin/sh\n"
            "case \" $* \" in *\" ls-remote --heads origin \"*) exit 72 ;; esac\n"
            "exec \"{}\" \"$@\"\n".format(real_git),
            encoding="utf-8",
        )
        fake_git.chmod(0o755)
        env = self.base_env.copy()
        # os.pathsep：POSIX 为 ":"（与原来一致）；Windows 为 ";"，避免 MSYS
        # 把 `C:\...` 拦腰拆成 "C"+相对路径而让前置目录从 PATH 中丢失。
        env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

        result = subprocess.run(
            [BASH, str(PUBLISH_SCRIPT), "--user-authorized", "--create-pr", "--json"],
            cwd=self.worktree,
            text=True,
            encoding="utf-8",
            capture_output=True,
            env=env,
        )

        self.assertEqual(result.returncode, 7)
        self.assertEqual(self.response(result)["status"], "REMOTE_READ_FAILED")

    def test_post_push_verification_rejects_conflict_or_diff_mismatch(self) -> None:
        self.git("push", "-u", "origin", "HEAD")
        head = self.git("rev-parse", "HEAD")
        for snapshot in (
            self.pr_snapshot(head_sha=head, conflict=True),
            self.pr_snapshot(head_sha=head, changed_files=[]),
        ):
            with self.subTest(snapshot=snapshot):
                result = run(
                    "bash",
                    str(VERIFY_SCRIPT),
                    "--update-pr",
                    "65",
                    "--pr-snapshot",
                    str(snapshot),
                    "--json",
                    cwd=self.worktree,
                )
                self.assertEqual(result.returncode, 8)
                self.assertEqual(self.response(result)["status"], "PR_EVIDENCE_INVALID")

    @unittest.skipIf(
        os.name == "nt",
        "Windows CreateProcess 无法执行无扩展名脚本，PATH 注入假 git 仅在 POSIX 有效"
        "（对应 test-hooks.sh 的 IS_WINDOWS 降级先例）",
    )
    def test_push_success_with_marker_write_failure_still_blocks_rollback(self) -> None:
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("local review fix")
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)
        recovery_file = Path(str(self.response(synced)["recovery_file"]))

        real_git = shutil.which("git") or "/usr/bin/git"
        fake_bin = self.root / "post-push-failure-bin"
        fake_bin.mkdir()
        fake_git = fake_bin / "git"
        fake_git.write_text(
            "#!/bin/sh\n"
            "\"{}\" \"$@\"\n"
            "status=$?\n"
            "case \" $* \" in *\" push \"*) [ $status -ne 0 ] || mkdir \"$FAIL_RECOVERY_TMP\" ;; esac\n"
            "exit $status\n".format(real_git),
            encoding="utf-8",
        )
        fake_git.chmod(0o755)
        env = self.base_env.copy()
        # os.pathsep：POSIX 为 ":"（与原来一致）；Windows 为 ";"，避免 MSYS
        # 把 `C:\...` 拦腰拆成 "C"+相对路径而让前置目录从 PATH 中丢失。
        env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]
        env["FAIL_RECOVERY_TMP"] = str(recovery_file) + ".tmp"

        published = self.invoke_update(env=env)

        self.assertNotEqual(published.returncode, 0)
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            self.git("rev-parse", "HEAD"),
        )
        rollback = run("bash", str(SYNC_SCRIPT), "rollback", "--json", cwd=self.worktree)
        self.assertEqual(rollback.returncode, 1)
        self.assertIn("推送", str(self.response(rollback)["detail"]))

    @unittest.skipIf(
        os.name == "nt",
        "Windows CreateProcess 无法执行无扩展名脚本，PATH 注入假 git 仅在 POSIX 有效"
        "（对应 test-hooks.sh 的 IS_WINDOWS 降级先例）",
    )
    def test_lost_push_ack_keeps_fail_closed_state_and_blocks_rollback(self) -> None:
        self.git("push", "-u", "origin", "HEAD")
        self.commit_followup("local review fix")
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)

        real_git = shutil.which("git") or "/usr/bin/git"
        fake_bin = self.root / "lost-ack-bin"
        fake_bin.mkdir()
        fake_git = fake_bin / "git"
        fake_git.write_text(
            "#!/bin/sh\n"
            "case \" $* \" in\n"
            "  *\" push \"*) \"{}\" \"$@\" || exit $?; exit 73 ;;\n"
            "esac\n"
            "exec \"{}\" \"$@\"\n".format(real_git, real_git),
            encoding="utf-8",
        )
        fake_git.chmod(0o755)
        env = self.base_env.copy()
        # os.pathsep：POSIX 为 ":"（与原来一致）；Windows 为 ";"，避免 MSYS
        # 把 `C:\...` 拦腰拆成 "C"+相对路径而让前置目录从 PATH 中丢失。
        env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

        published = self.invoke_update(env=env)

        self.assertEqual(published.returncode, 5)
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            self.git("rev-parse", "HEAD"),
        )
        rollback = run("bash", str(SYNC_SCRIPT), "rollback", "--json", cwd=self.worktree)
        self.assertEqual(rollback.returncode, 1)
        self.assertIn("推送", str(self.response(rollback)["detail"]))

    def test_successful_create_after_sync_also_prevents_local_rollback(self) -> None:
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)
        published = self.invoke("--user-authorized", "--create-pr", "--json")
        self.assertEqual(published.returncode, 0, published.stderr)

        rollback = run("bash", str(SYNC_SCRIPT), "rollback", "--json", cwd=self.worktree)

        self.assertEqual(rollback.returncode, 1)
        payload = self.response(rollback)
        self.assertEqual(payload["status"], "ERROR")
        self.assertIn("推送", str(payload["detail"]))

        verified = run(
            "bash",
            str(VERIFY_SCRIPT),
            "--update-pr",
            "65",
            "--pr-snapshot",
            str(self.pr_snapshot(head_sha=self.git("rev-parse", "HEAD"))),
            "--json",
            cwd=self.worktree,
        )
        self.assertEqual(verified.returncode, 0, verified.stderr)
        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(finalized.returncode, 0, finalized.stderr)

    def test_publish_recovery_helpers_skip_windows_store_python_stub(self) -> None:
        (self.main / "upstream.txt").write_text("upstream\n", encoding="utf-8")
        self.git("add", "upstream.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance master", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stderr)

        fake_bin = self.root / "WindowsApps"
        fake_bin.mkdir()
        python_stub = fake_bin / "python3"
        python_stub.write_text("#!/bin/sh\nexit 91\n", encoding="utf-8")
        python_stub.chmod(0o755)
        py_launcher = fake_bin / "py"
        py_launcher.write_text(
            "#!/bin/sh\n[ \"$1\" = \"-3\" ] && shift\nexec \"{}\" \"$@\"\n".format(sys.executable),
            encoding="utf-8",
        )
        py_launcher.chmod(0o755)
        env = self.base_env.copy()
        # os.pathsep：POSIX 为 ":"（与原来一致）；Windows 为 ";"，避免 MSYS
        # 把 `C:\...` 拦腰拆成 "C"+相对路径而让前置目录从 PATH 中丢失。
        env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

        result = subprocess.run(
            [BASH, str(PUBLISH_SCRIPT), "--user-authorized", "--create-pr", "--json"],
            cwd=self.worktree,
            text=True,
            encoding="utf-8",
            capture_output=True,
            env=env,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.response(result)["status"], "PUSHED_CREATE_PR")


if __name__ == "__main__":
    unittest.main()
