#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import runpy
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

try:
    from .bash_helper import BASH
except ImportError:
    from bash_helper import BASH


REPO_ROOT = Path(__file__).resolve().parents[2]
PUBLISH_SCRIPT = REPO_ROOT / "scripts" / "publish-review-package.sh"
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync-task-from-origin.sh"
VERIFY_SCRIPT = REPO_ROOT / "scripts" / "verify-pr-update.sh"
CLEANUP_CHILD_SCRIPT = REPO_ROOT / "scripts" / "cleanup-implement-spec-child.py"
CREATE_PR_HOOK = REPO_ROOT / ".claude" / "hooks" / "confirm-release-action.sh"
BRANCH = "feature/测试已有PR更新流程"
load_recovery = runpy.run_path(str(REPO_ROOT / "scripts/sync_recovery.py"))["load_recovery"]


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
        self.base_env["PATH"] = str(self.fake_bin) + os.pathsep + self.base_env["PATH"]
        self.base_env["REAL_NODE"] = self.real_node
        self.base_env["VERIFICATION_LOG"] = str(self.verification_log)
        run("git", "init", "--bare", str(self.origin), cwd=self.root, check=True)
        run("git", "init", str(self.main), cwd=self.root, check=True)
        self.configure(self.main)
        (self.main / "base.txt").write_text("base\n", encoding="utf-8")
        hooks = self.main / ".githooks"
        hooks.mkdir()
        (hooks / "pre-push").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        (hooks / "pre-push").chmod(0o755)
        self.git("add", "base.txt", ".githooks", cwd=self.main)
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

    def test_integration_child_cannot_create_or_update_pr(self) -> None:
        metadata_path = Path(self.git("rev-parse", "--absolute-git-dir")) / "blue-whale/task-base.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        metadata["inherited_sha"] = metadata["start_sha"]
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        created = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
        updated = self.invoke_update(self.pr_snapshot())

        self.assertEqual(self.response(created)["status"], "INTEGRATION_CHILD_NO_PR")
        self.assertEqual(self.response(updated)["status"], "INTEGRATION_CHILD_NO_PR")
        self.assertFalse(self.publish_marker().exists())
        self.assertFalse(self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)))

    def test_create_and_update_modes_are_mutually_exclusive(self) -> None:
        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--update-pr", "65", "--json")

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

        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")

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

    def test_create_mode_rejects_failed_child_tree_proof_before_push(self) -> None:
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        marker.write_text(json.dumps({"rebase_tree_failed": True}), encoding="utf-8")

        rejected = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")

        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(self.response(rejected)["status"], "INVALID_RECOVERY")
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}"), ""
        )

    def test_existing_worktree_hook_override_is_enabled_before_publication(self) -> None:
        self.git("config", "extensions.worktreeConfig", "true")
        self.git("config", "--worktree", "core.hooksPath", "/dev/null")
        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(".githooks", self.git("config", "--get", "core.hooksPath"))
        self.assertEqual(".githooks", self.git("config", "--local", "--get", "core.hooksPath"))
        self.assertIn("ensure --stage pr --json", self.verification_log.read_text(encoding="utf-8"))

    def test_head_changed_during_local_checks_is_not_pushed(self) -> None:
        fake_node = self.fake_bin / "node"
        fake_node.write_text(
            "#!/bin/sh\n"
            "case \"$1\" in\n"
            "  */scripts/verify-change-scope.mjs)\n"
            "    if [ \"$2\" = ensure ]; then git commit --allow-empty -m 'chore: concurrent local edit' >/dev/null; fi\n"
            "    exit 0 ;;\n"
            "esac\n"
            "exec \"$REAL_NODE\" \"$@\"\n",
            encoding="utf-8",
        )
        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
        self.assertEqual(11, result.returncode, result.stdout + result.stderr)
        self.assertEqual("HEAD_CHANGED", self.response(result)["status"])
        self.assertEqual("", self.git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}"))
        self.assertFalse(self.publish_marker().exists())

    def test_head_moving_after_the_gate_cannot_change_the_pushed_commit(self) -> None:
        verified_head = self.git("rev-parse", "HEAD")
        real_git = shutil.which("git")
        moved = self.root / "head-moved"
        fake_git = self.fake_bin / "git"
        fake_git.write_text(
            "#!/bin/sh\n"
            f'case "$*" in *"ls-remote --heads origin refs/heads/{BRANCH}"*)\n'
            '  if [ ! -f "$FIXTURE_HEAD_MOVED" ]; then\n'
            '    "$REAL_GIT" commit --allow-empty -m "chore: concurrent edit after gate" >/dev/null\n'
            '    touch "$FIXTURE_HEAD_MOVED"\n'
            '  fi ;;\n'
            "esac\n"
            'exec "$REAL_GIT" "$@"\n',
            encoding="utf-8",
        )
        fake_git.chmod(0o755)
        env = {**self.base_env, "REAL_GIT": real_git, "FIXTURE_HEAD_MOVED": str(moved)}
        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json", env=env)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertNotEqual(verified_head, self.git("rev-parse", "HEAD"))
        self.assertEqual(verified_head, self.git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}").split()[0])
        self.assertIn(f"head={verified_head}\n", self.publish_marker().read_text(encoding="utf-8"))
        self.assertEqual(f"refs/heads/{BRANCH}", self.git("config", f"branch.{BRANCH}.merge"))

    def test_create_mode_can_bind_an_explicit_draft_marker(self) -> None:
        result = self.invoke(
            "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--draft-pr",
            "--draft-reason", "用户明确要求先创建草稿", "--json",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("draft=true", self.publish_marker().read_text(encoding="utf-8"))
        self.assertIn("draft_reason=用户明确要求先创建草稿", self.publish_marker().read_text(encoding="utf-8"))

    def test_draft_requires_a_single_line_nonempty_basis_before_push(self) -> None:
        for reason in (None, "", " \t", "用户要求\ndraft=false", "用户要求\r其他字段"):
            with self.subTest(reason=reason):
                args = ["--user-authorized", "--create-pr", "--target-branch", "release/prod", "--draft-pr", "--json"]
                if reason is not None:
                    args.extend(["--draft-reason", reason])
                result = self.invoke(*args)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.response(result)["status"], "DRAFT_REASON_REQUIRED")
                self.assertFalse(self.publish_marker().exists())
                self.assertEqual("", self.git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}"))

    def test_post_deployment_not_run_does_not_select_draft(self) -> None:
        report = "工程交付 PASS；部署后业务验收 NOT_RUN，原因：尚未部署，责任：业务验收人"
        self.commit_followup(report)

        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("draft=false", self.publish_marker().read_text(encoding="utf-8"))
        self.assertEqual(report, self.git("show", f"origin/{BRANCH}:task.txt"))

    def test_release_prerequisites_block_ordinary_and_draft_before_push(self) -> None:
        fake_node = self.fake_bin / "node"
        for outcome in ("FAIL", "SKIPPED", "BLOCKED"):
            for gate, status in (("ensure", "VERIFICATION_FAILED"), ("check", "VERIFICATION_REQUIRED")):
                for draft in (False, True):
                    with self.subTest(outcome=outcome, gate=gate, draft=draft):
                        fake_node.write_text(
                            "#!/bin/sh\n"
                            'case "$1" in\n'
                            "  */scripts/verify-change-scope.mjs)\n"
                            f'    if [ "$2" = {gate} ]; then printf \'{outcome}\\n\'; exit 1; fi\n'
                            "    exit 0 ;;\n"
                            "esac\n"
                            'exec "$REAL_NODE" "$@"\n',
                            encoding="utf-8",
                        )
                        args = ["--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"]
                        if draft:
                            args.extend(["--draft-pr", "--draft-reason", "已确认规格明确要求草稿"])
                        result = self.invoke(*args)
                        self.assertEqual(result.returncode, 11, result.stderr)
                        self.assertEqual(self.response(result)["status"], status)
                        self.assertIn(outcome, self.response(result)["detail"])
                        self.assertFalse(self.publish_marker().exists())
                        self.assertEqual("", self.git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}"))

    def test_draft_reason_requires_draft_creation_mode(self) -> None:
        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--draft-reason", "用户要求", "--json")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_ARGUMENT")
        self.assertFalse(self.publish_marker().exists())

    def test_create_pr_hook_rejects_source_commit_after_marker(self) -> None:
        created = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        self.assertEqual(0, self.invoke_create_pr_hook().returncode)
        self.commit_followup("after marker")
        self.git("push", "origin", f"HEAD:refs/heads/{BRANCH}")

        blocked = self.invoke_create_pr_hook()

        self.assertEqual(2, blocked.returncode)
        self.assertIn("源分支", blocked.stderr)

    def test_create_pr_hook_rejects_target_advance_after_marker(self) -> None:
        created = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
        self.assertEqual(0, created.returncode, created.stderr)
        self.assertEqual(0, self.invoke_create_pr_hook().returncode)
        self.git("commit", "--allow-empty", "-m", "chore: advance target", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)

        blocked = self.invoke_create_pr_hook()

        self.assertEqual(2, blocked.returncode)
        self.assertIn("目标分支", blocked.stderr)

    def test_create_pr_hook_rejects_other_repository_scope(self) -> None:
        created = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
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

        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json", env=env)

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

    def test_create_mode_supports_environment_target_and_binds_marker(self) -> None:
        for target in ("dev", "test"):
            with self.subTest(target=target):
                self.git("branch", target, cwd=self.main)
                self.git("push", "origin", target, cwd=self.main)
                metadata = (Path(self.git("rev-parse", "--absolute-git-dir"))
                            / "blue-whale" / "task-base.json")
                data = json.loads(metadata.read_text(encoding="utf-8"))
                data["target_branch"] = target
                metadata.write_text(json.dumps(data), encoding="utf-8")
                try:
                    result = self.invoke(
                        "--user-authorized", "--create-pr", "--target-branch", target, "--json"
                    )

                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn(
                        f"target={target}", self.publish_marker().read_text(encoding="utf-8")
                    )
                finally:
                    data["target_branch"] = "release/prod"
                    metadata.write_text(json.dumps(data), encoding="utf-8")

    def test_create_mode_requires_explicit_target_branch(self) -> None:
        result = self.invoke("--user-authorized", "--create-pr", "--json")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.response(result)["status"], "INVALID_TARGET_BRANCH")
        self.assertFalse(self.publish_marker().exists())

    def test_create_mode_rejects_unprotected_target(self) -> None:
        for target in ("develop", "release/"):
            with self.subTest(target=target):
                result = self.invoke(
                    "--user-authorized", "--create-pr", "--target-branch", target, "--json"
                )

                self.assertEqual(result.returncode, 2)
                self.assertEqual(self.response(result)["status"], "INVALID_TARGET_BRANCH")

    def test_create_mode_accepts_master_target(self) -> None:
        self.git("push", "origin", "HEAD:master", cwd=self.main)
        metadata = (Path(self.git("rev-parse", "--absolute-git-dir"))
                    / "blue-whale" / "task-base.json")
        data = json.loads(metadata.read_text(encoding="utf-8"))
        data["target_branch"] = "master"
        metadata.write_text(json.dumps(data), encoding="utf-8")
        try:
            result = self.invoke(
                "--user-authorized", "--create-pr", "--target-branch", "master", "--json"
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("target=master", self.publish_marker().read_text(encoding="utf-8"))
        finally:
            data["target_branch"] = "release/prod"
            metadata.write_text(json.dumps(data), encoding="utf-8")

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
        self.assertEqual(payload["changed_files_count"], 1)
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", "refs/heads/{}".format(BRANCH)).split()[0],
            expected_head,
        )
        self.assertFalse(self.publish_marker().exists())

    def test_normalize_mcp_evidence_uses_immutable_diff_refs(self) -> None:
        head = self.git("rev-parse", "HEAD")
        detail = {
            "iid": 65, "state": "opened", "conflict": False,
            "source_branch": {"branch": BRANCH},
            "target_branch": {"branch": "release/prod"},
        }
        evidence = {
            "detail": detail,
            "diff": {**detail, "diff_refs": {
                "base_sha": self.git("rev-parse", "origin/release/prod"), "head_sha": head,
            }},
            "fetched_at": int(time.time()),
        }
        args = [sys.executable, str(REPO_ROOT / "scripts/pr-update-evidence.py"),
                "normalize", "--update-pr", "65", "--json"]
        normalized = subprocess.run(args, cwd=self.worktree, input=json.dumps(evidence),
                                    text=True, encoding="utf-8", capture_output=True)
        self.assertEqual(normalized.returncode, 0, normalized.stderr)
        snapshot = json.loads(normalized.stdout)
        self.assertEqual(snapshot["changed_files"], ["task.txt"])
        self.assertEqual(snapshot["head_sha"], head)
        self.assertEqual(snapshot["fetched_at"], evidence["fetched_at"])

        evidence["diff"]["iid"] = 66
        rejected = subprocess.run(args, cwd=self.worktree, input=json.dumps(evidence),
                                  text=True, encoding="utf-8", capture_output=True)
        self.assertEqual(rejected.returncode, 8)

    def test_stdin_snapshot_is_cleaned_after_rejection_and_success(self) -> None:
        remote_head = self.git("rev-parse", "HEAD")
        self.git("push", "-u", "origin", "HEAD")
        head = self.commit_followup("stdin review fix")
        snapshot = json.loads(self.pr_snapshot().read_text(encoding="utf-8"))
        temporary = self.root / "temporary-snapshots"
        temporary.mkdir()
        env = {**self.base_env, "TMPDIR": temporary.as_posix()}
        args = [BASH, str(PUBLISH_SCRIPT), "--user-authorized", "--update-pr", "65",
                "--pr-snapshot", "-", "--json"]
        rejected = subprocess.run(args, cwd=self.worktree,
                                  input=json.dumps({**snapshot, "state": "closed"}),
                                  text=True, encoding="utf-8", capture_output=True, env=env)
        self.assertEqual(rejected.returncode, 8, rejected.stderr)
        self.assertEqual(list(temporary.iterdir()), [])
        self.assertEqual(self.git("ls-remote", "origin", f"refs/heads/{BRANCH}").split()[0], remote_head)

        published = subprocess.run(args, cwd=self.worktree, input=json.dumps(snapshot),
                                   text=True, encoding="utf-8", capture_output=True, env=env)
        self.assertEqual(published.returncode, 0, published.stderr)
        self.assertEqual(list(temporary.iterdir()), [])
        self.assertEqual(self.response(published)["head"], head)
        self.assertEqual(self.response(published)["changed_files_count"], 1)
        self.assertNotIn("changed_files", self.response(published))

    def test_stdin_verification_keeps_existing_evidence_checks(self) -> None:
        snapshot = json.loads(self.pr_snapshot(head_sha=self.git("rev-parse", "HEAD"))
                              .read_text(encoding="utf-8"))
        args = [BASH, str(VERIFY_SCRIPT), "--update-pr", "65", "--pr-snapshot", "-", "--json"]
        verified = subprocess.run(args, cwd=self.worktree, input=json.dumps(snapshot),
                                  text=True, encoding="utf-8", capture_output=True)
        self.assertEqual(verified.returncode, 0, verified.stderr)
        self.assertEqual(self.response(verified)["changed_files_count"], 1)
        for invalid in ({"conflict": True}, {"fetched_at": int(time.time()) - 301},
                        {"changed_files": ["other.txt"]}, {"head_sha": "a" * 40}):
            with self.subTest(invalid=invalid):
                result = subprocess.run(args, cwd=self.worktree,
                                        input=json.dumps({**snapshot, **invalid}),
                                        text=True, encoding="utf-8", capture_output=True)
                self.assertEqual(result.returncode, 8, result.stderr)

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

    def implement_spec_child(self, *, inherited: bool = False,
                             extra_merge: bool = False) -> tuple[str, Path]:
        child_branch = "fix/IKIOS6-受控线性化子任务"
        child_root = self.root / "blue-whale-worktrees" / "child"
        self.git("worktree", "add", "-b", child_branch, str(child_root), "release/prod", cwd=self.main)
        self.configure(child_root)
        metadata = Path(self.git("rev-parse", "--absolute-git-dir", cwd=child_root)) / "blue-whale/task-base.json"
        metadata.parent.mkdir(parents=True)
        payload = {
            "version": 1, "task_branch": child_branch, "target_branch": "release/prod",
            "start_sha": self.git("rev-parse", "release/prod", cwd=self.main),
        }
        if inherited:
            self.git("merge", "--no-ff", "--no-edit", "-m", "chore: 继承整包父整合提交",
                     self.git("rev-parse", "HEAD"), cwd=child_root)
            payload["inherited_sha"] = self.git("rev-parse", "HEAD", cwd=child_root)
            metadata.with_name("task-integration-sha").write_text(
                payload["inherited_sha"] + "\n", encoding="utf-8"
            )
        metadata.write_text(json.dumps(payload), encoding="utf-8")
        (child_root / "child.txt").write_text("child\n", encoding="utf-8")
        self.git("add", "child.txt", cwd=child_root)
        self.git("commit", "-m", "fix: child", cwd=child_root)
        if extra_merge:
            self.git("branch", "fix/额外合并", payload["inherited_sha"], cwd=child_root)
            self.git("switch", "fix/额外合并", cwd=child_root)
            (child_root / "extra.txt").write_text("extra\n", encoding="utf-8")
            self.git("add", "extra.txt", cwd=child_root)
            self.git("commit", "-m", "fix: extra", cwd=child_root)
            self.git("switch", child_branch, cwd=child_root)
            self.git("merge", "--no-ff", "--no-edit", "fix/额外合并", cwd=child_root)
        self.git("merge", "--no-ff", "--no-edit", child_branch)
        return child_branch, child_root

    def invoke_linearize(self, snapshot: Path, child_branch: str, *extra: str):
        return subprocess.run(
            [BASH, str(SYNC_SCRIPT), "linearize", "--update-pr", "65",
             "--pr-snapshot", str(snapshot), "--child-branch", child_branch,
             *extra, "--json"], cwd=self.worktree, text=True, encoding="utf-8",
            capture_output=True, env=self.base_env,
        )

    def test_authorized_linearization_preserves_tree_and_reuses_update_lease(self) -> None:
        child_branch, _ = self.implement_spec_child()
        original = self.git("rev-parse", "HEAD")
        tree = self.git("rev-parse", "HEAD^{tree}")
        self.git("push", "origin", BRANCH)
        snapshot = self.pr_snapshot()

        denied = self.invoke_linearize(snapshot, child_branch)
        self.assertNotEqual(denied.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), original)
        rewritten = self.invoke_linearize(snapshot, child_branch, "--user-authorized")
        self.assertEqual(rewritten.returncode, 0, rewritten.stdout + rewritten.stderr)
        self.assertEqual(self.response(rewritten)["status"], "LINEARIZED")
        self.assertEqual(self.git("rev-parse", "HEAD^{tree}"), tree)
        self.assertEqual(self.git("rev-list", "--merges", "origin/release/prod..HEAD"), "")
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["original_head"], original)
        self.assertIn("run --stage pr", self.verification_log.read_text(encoding="utf-8"))

        reviewed_head = self.commit_followup("review correction")
        refreshed = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(refreshed.returncode, 0, refreshed.stdout + refreshed.stderr)
        self.assertEqual(json.loads(marker.read_text(encoding="utf-8"))["synced_head"], reviewed_head)

        published = self.invoke_update(snapshot)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        self.assertEqual(self.response(published)["status"], "PUSHED_UPDATE_PR")

    def test_shared_reader_accepts_both_real_linearization_write_stages(self) -> None:
        child_branch, _ = self.implement_spec_child()
        self.git("push", "origin", BRANCH)
        snapshot = self.pr_snapshot()
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        captured = self.root / "before-linearization.json"
        real_git = shutil.which("git")
        wrapper = self.fake_bin / "git"
        wrapper.write_text(
            "#!/bin/sh\ncase \" $* \" in\n"
            "  *\" commit-tree \"*) cp {} {} ;;\nesac\nexec {} \"$@\"\n".format(
                shlex.quote(str(marker)), shlex.quote(str(captured)), shlex.quote(real_git)),
            encoding="utf-8",
        )
        wrapper.chmod(0o755)

        result = self.invoke_linearize(snapshot, child_branch, "--user-authorized")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        initial = load_recovery(captured)
        self.assertNotIn("synced_head", initial)
        self.assertNotIn("linearized_head", initial)
        completed = load_recovery(marker)
        self.assertEqual(completed["linearized_head"], self.git("rev-parse", "HEAD"))
        self.assertNotIn("push_state", completed)
        self.assertNotIn("verified_head", completed)

    def finalize_after_backup_unlock(self) -> subprocess.CompletedProcess[str]:
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        recovery = load_recovery(marker)
        common = Path(self.git("rev-parse", "--git-common-dir"))
        lock = common / (recovery["backup_ref"] + ".lock")
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text("locked", encoding="utf-8")
        rejected = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(rejected.returncode, 1, rejected.stdout + rejected.stderr)
        self.assertIn("backup ref", self.response(rejected)["detail"])
        self.assertTrue(marker.exists())
        lock.unlink()
        return run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)

    def test_linearization_accepts_verified_child_inheritance_merge(self) -> None:
        child_branch, child_root = self.implement_spec_child(inherited=True)
        inherited = json.loads((Path(self.git("rev-parse", "--absolute-git-dir", cwd=child_root))
                                / "blue-whale/task-base.json").read_text(encoding="utf-8"))["inherited_sha"]
        original = self.git("rev-parse", "HEAD")
        original_tree = self.git("rev-parse", "HEAD^{tree}")
        self.assertIn(inherited, self.git("rev-list", "--merges", f"origin/release/prod..{original}"))
        self.git("push", "origin", BRANCH)

        result = self.invoke_linearize(self.pr_snapshot(), child_branch, "--user-authorized")

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.response(result)["status"], "LINEARIZED")
        self.assertEqual(self.git("rev-parse", "HEAD^{tree}"), original_tree)
        self.assertEqual(self.git("rev-list", "--merges", "origin/release/prod..HEAD"), "")

    def test_linearization_rejects_extra_child_merge(self) -> None:
        child_branch, _ = self.implement_spec_child(inherited=True, extra_merge=True)
        original = self.git("rev-parse", "HEAD")
        self.git("push", "origin", BRANCH)

        result = self.invoke_linearize(self.pr_snapshot(), child_branch, "--user-authorized")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("无法对应子任务继承记录", result.stdout)
        self.assertEqual(self.git("rev-parse", "HEAD"), original)

    def test_linearization_rejects_untracked_merge_parent_and_scope_expansion(self) -> None:
        child_branch, child_root = self.implement_spec_child()
        original = self.git("rev-parse", "HEAD")
        self.git("push", "origin", BRANCH)
        wrong = self.pr_snapshot(changed_files=["task.txt"])
        rejected = self.invoke_linearize(wrong, child_branch, "--user-authorized")
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), original)

        self.git("reset", "--hard", "HEAD^", cwd=child_root)
        correct = self.pr_snapshot()
        rejected = self.invoke_linearize(correct, child_branch, "--user-authorized")
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("无法证明", rejected.stdout)
        self.assertEqual(self.git("rev-parse", "HEAD"), original)

    def test_linearization_rejects_changed_remote_source(self) -> None:
        child_branch, _ = self.implement_spec_child()
        self.git("push", "origin", BRANCH)
        snapshot = self.pr_snapshot()
        attacker = self.root / "attacker-linearize"
        run("git", "clone", str(self.origin), str(attacker), cwd=self.root, check=True)
        self.configure(attacker)
        self.git("checkout", "-b", BRANCH, f"origin/{BRANCH}", cwd=attacker)
        (attacker / "remote.txt").write_text("remote\n", encoding="utf-8")
        self.git("add", "remote.txt", cwd=attacker)
        self.git("commit", "-m", "fix: concurrent update", cwd=attacker)
        self.git("push", "origin", BRANCH, cwd=attacker)
        result = self.invoke_linearize(snapshot, child_branch, "--user-authorized")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("未知远端", result.stdout)

    def test_linearized_update_rejects_lease_change(self) -> None:
        child_branch, _ = self.implement_spec_child()
        self.git("push", "origin", BRANCH)
        snapshot = self.pr_snapshot()
        rewritten = self.invoke_linearize(snapshot, child_branch, "--user-authorized")
        self.assertEqual(rewritten.returncode, 0, rewritten.stdout + rewritten.stderr)
        attacker = self.root / "attacker-after-linearize"
        run("git", "clone", str(self.origin), str(attacker), cwd=self.root, check=True)
        self.configure(attacker)
        self.git("checkout", "-b", BRANCH, f"origin/{BRANCH}", cwd=attacker)
        (attacker / "remote.txt").write_text("remote\n", encoding="utf-8")
        self.git("add", "remote.txt", cwd=attacker)
        self.git("commit", "-m", "fix: concurrent update", cwd=attacker)
        self.git("push", "origin", BRANCH, cwd=attacker)

        rejected = self.invoke_update(snapshot)
        self.assertEqual(rejected.returncode, 5)
        self.assertEqual(self.response(rejected)["status"], "REMOTE_LEASE_CHANGED")
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        self.assertTrue(marker.exists())

    def test_linearized_pr_readback_allows_child_cleanup_before_release_merge(self) -> None:
        child_branch, child_root = self.implement_spec_child()
        child_head = self.git("rev-parse", "HEAD", cwd=child_root)
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        rewritten = self.invoke_linearize(before, child_branch, "--user-authorized")
        self.assertEqual(rewritten.returncode, 0, rewritten.stdout + rewritten.stderr)
        self.commit_followup("review corrected")
        refreshed = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(refreshed.returncode, 0, refreshed.stdout + refreshed.stderr)
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        after = self.pr_snapshot()
        source_head = self.git("rev-parse", "HEAD")
        self.assertNotEqual(run("git", "merge-base", "--is-ancestor", child_head, source_head,
                                cwd=self.worktree).returncode, 0)
        premature = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(after),
                        "--json", cwd=child_root)
        self.assertNotEqual(premature.returncode, 0)
        self.assertTrue(child_root.exists())
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(after), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        original_head = json.loads(marker.read_text(encoding="utf-8"))["original_head"]
        lineage_ref = "refs/agent-implement-spec-lineage/" + BRANCH.replace("/", "%")
        self.git("update-ref", lineage_ref, child_head)
        rejected = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("保留引用", str(self.response(rejected)["detail"]))
        self.git("update-ref", lineage_ref, original_head)
        finalized = self.finalize_after_backup_unlock()
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)
        cleaned = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(after),
                      "--json", cwd=child_root)
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(child_root.exists())
        self.assertEqual(self.git("rev-parse", "release/prod", cwd=self.main),
                         self.git("rev-parse", "master", cwd=self.main))

    def test_child_cleanup_after_parent_sync_rebases_published_pr(self) -> None:
        _, child_root = self.implement_spec_child()
        child_head = self.git("rev-parse", "HEAD", cwd=child_root)
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        (self.main / "release.txt").write_text("release\n", encoding="utf-8")
        self.git("add", "release.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)

        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stdout + synced.stderr)
        self.assertNotEqual(run("git", "merge-base", "--is-ancestor", child_head, "HEAD",
                                cwd=self.worktree).returncode, 0)
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        after = self.pr_snapshot()
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(after), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)

        (self.main / "release-next.txt").write_text("next\n", encoding="utf-8")
        self.git("add", "release-next.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release again", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        second_sync = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(second_sync.returncode, 0, second_sync.stdout + second_sync.stderr)
        second_publish = self.invoke_update(after)
        self.assertEqual(second_publish.returncode, 0, second_publish.stdout + second_publish.stderr)
        latest = self.pr_snapshot()
        second_verify = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                            "--pr-snapshot", str(latest), "--json", cwd=self.worktree)
        self.assertEqual(second_verify.returncode, 0, second_verify.stdout + second_verify.stderr)
        second_finalize = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(second_finalize.returncode, 0, second_finalize.stdout + second_finalize.stderr)

        common = Path(self.git("rev-parse", "--git-common-dir"))
        lineage_dir = common / "blue-whale" / "implement-spec-rebase-lineage" / BRANCH.replace("/", "%")
        records = list(lineage_dir.glob("*.json"))
        self.assertEqual(2, len(records))
        original_record = next(path for path in records if child_head in path.read_text(encoding="utf-8"))
        original_content = original_record.read_text(encoding="utf-8")
        tampered = json.loads(original_content)
        tampered["merged_tree"] = "0" * 40
        original_record.write_text(json.dumps(tampered), encoding="utf-8")
        rejected = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(latest),
                       "--json", cwd=child_root)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertTrue(child_root.exists())
        original_record.write_text(original_content, encoding="utf-8")
        wrong_pr = run(sys.executable, CLEANUP_CHILD_SCRIPT,
                       "--pr-snapshot", str(self.pr_snapshot(iid=66)), "--json", cwd=child_root)
        self.assertNotEqual(wrong_pr.returncode, 0)
        self.assertTrue(child_root.exists())

        cleaned = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(latest),
                      "--json", cwd=child_root)
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(child_root.exists())
        self.assertEqual("child\n", (self.worktree / "child.txt").read_text(encoding="utf-8"))
        self.assertEqual("release\n", (self.worktree / "release.txt").read_text(encoding="utf-8"))
        self.assertEqual("next\n", (self.worktree / "release-next.txt").read_text(encoding="utf-8"))

    def merged_rebased_child(self, *, source_as_child=False):
        child_branch, child_root = self.implement_spec_child(inherited=True)
        if source_as_child:
            self.git("merge", "--ff-only", self.git("rev-parse", "HEAD"), cwd=child_root)
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        (self.main / "release.txt").write_text("release\n", encoding="utf-8")
        self.git("add", "release.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stdout + synced.stderr)
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        after = self.pr_snapshot()
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(after), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)
        source_head = self.git("rev-parse", "HEAD")
        self.git("merge", "--no-ff", "--no-edit", BRANCH, cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        self.git("push", "origin", "--delete", BRANCH, cwd=self.main)
        self.git("worktree", "remove", str(self.worktree), cwd=self.main)
        self.git("branch", "-d", BRANCH, cwd=self.main)
        common = Path(self.git("rev-parse", "--git-common-dir", cwd=child_root))
        record = common / "blue-whale" / "implement-spec-rebase-lineage" / BRANCH.replace("/", "%") / f"{source_head}.json"
        return child_branch, child_root, source_head, record

    def test_merged_pr_cleanup_proves_original_source_without_child_mapping(self) -> None:
        child_branch, child_root, source_head, record = self.merged_rebased_child(source_as_child=True)
        data = json.loads(record.read_text(encoding="utf-8"))
        data["child_heads"].pop(child_branch, None)
        record.write_text(json.dumps(data), encoding="utf-8")
        snapshot = self.pr_snapshot(state="merged", head_sha=source_head, changed_files=[])
        cleaned = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(snapshot),
                      "--json", cwd=child_root)
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(child_root.exists())
        self.assertEqual("child\n", (self.main / "child.txt").read_text(encoding="utf-8"))

    def test_merged_pr_cleanup_proves_rebased_child_without_integration_worktree(self) -> None:
        child_branch, child_root, source_head, _ = self.merged_rebased_child()
        snapshot = self.pr_snapshot(state="merged", head_sha=source_head, changed_files=[])
        cleaned = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(snapshot),
                      "--json", cwd=child_root)
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(child_root.exists())
        self.assertNotEqual(run("git", "show-ref", "--verify", f"refs/heads/{child_branch}",
                                cwd=self.main).returncode, 0)

    def test_merged_pr_cleanup_rejects_invalid_original_source_proof(self) -> None:
        child_branch, child_root, source_head, record = self.merged_rebased_child(source_as_child=True)
        data = json.loads(record.read_text(encoding="utf-8"))
        data["child_heads"].pop(child_branch, None)
        original = json.dumps(data)
        data["merged_tree"] = "0" * 40
        record.write_text(json.dumps(data), encoding="utf-8")
        snapshot = self.pr_snapshot(state="merged", head_sha=source_head, changed_files=[])
        rejected = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(snapshot),
                       "--json", cwd=child_root)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("同步证明未通过", rejected.stdout)
        self.assertTrue(child_root.exists())
        record.write_text(original, encoding="utf-8")
        wrong_pr = self.pr_snapshot(iid=66, state="merged", head_sha=source_head, changed_files=[])
        rejected = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(wrong_pr),
                       "--json", cwd=child_root)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertTrue(child_root.exists())

    def test_sync_rejects_child_tree_mismatch_before_pr_update(self) -> None:
        self.implement_spec_child()
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        remote_head = self.git("rev-parse", "HEAD")
        (self.main / "release.txt").write_text("release\n", encoding="utf-8")
        self.git("add", "release.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)

        fake_git = self.fake_bin / "git"
        fake_git.write_text(
            "#!/bin/sh\n"
            "command=$1\n"
            "if [ \"$1\" = \"-C\" ]; then command=$3; fi\n"
            "if [ \"$command\" = \"merge-tree\" ]; then printf '%040d\\n' 0; exit 0; fi\n"
            "exec \"$REAL_GIT\" \"$@\"\n",
            encoding="utf-8",
        )
        fake_git.chmod(0o755)
        env = {**self.base_env, "REAL_GIT": shutil.which("git") or "/usr/bin/git"}
        synced = subprocess.run(
            [BASH, str(SYNC_SCRIPT), "sync", "--json"], cwd=self.worktree,
            text=True, encoding="utf-8", capture_output=True, env=env,
        )
        self.assertEqual(synced.returncode, 4, synced.stdout + synced.stderr)
        self.assertEqual(self.response(synced)["status"], "VERIFICATION_FAILED")
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        self.assertTrue(json.loads(marker.read_text(encoding="utf-8"))["rebase_tree_failed"])
        rejected = self.invoke_update(before, env=env)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(self.response(rejected)["status"], "INVALID_RECOVERY")
        failed_head = self.git("rev-parse", "HEAD")
        (self.main / "release-next.txt").write_text("next\n", encoding="utf-8")
        self.git("add", "release-next.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release again", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        still_failed = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertNotEqual(still_failed.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), failed_head)
        self.assertTrue(json.loads(marker.read_text(encoding="utf-8"))["rebase_tree_failed"])
        rejected_again = self.invoke_update(before, env=env)
        self.assertNotEqual(rejected_again.returncode, 0)
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        recovery["push_state"] = "pushed"
        recovery["pushed_head"] = self.git("rev-parse", "HEAD")
        recovery["verified_head"] = recovery["pushed_head"]
        recovery["verified_pr_iid"] = 65
        marker.write_text(json.dumps(recovery), encoding="utf-8")
        unfinalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertNotEqual(unfinalized.returncode, 0)
        self.assertIn("文件树核对失败", str(self.response(unfinalized)["detail"]))
        self.assertTrue(marker.exists())
        self.assertEqual(
            self.git("ls-remote", "--heads", "origin", f"refs/heads/{BRANCH}").split()[0],
            remote_head,
        )

    def test_sync_proves_current_rebase_without_reusing_old_conflicted_source(self) -> None:
        child_branch, child_root = self.implement_spec_child()
        child_head = self.git("rev-parse", "HEAD", cwd=child_root)
        old_source = self.git("rev-parse", "HEAD")
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        backup_ref = "refs/agent-sync-backups/" + BRANCH.replace("/", "%")
        self.git("update-ref", backup_ref, old_source)
        self.git("reset", "--hard", "release/prod")
        (self.worktree / "child.txt").write_text("child\n", encoding="utf-8")
        self.git("add", "child.txt")
        self.git("commit", "-m", "fix: preserve resolved child content")
        resolved = self.git("rev-parse", "HEAD")
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        marker.write_text(json.dumps({
            "version": 1, "branch": BRANCH, "original_head": old_source,
            "synced_head": resolved, "upstream_sha": self.git("rev-parse", "release/prod"),
            "target_branch": "release/prod", "remote_branch_sha": old_source,
            "backup_ref": backup_ref, "child_heads": {child_branch: child_head},
            "created_at": 0,
        }), encoding="utf-8")
        marker.chmod(0o600)
        (self.main / "release.txt").write_text("release\n", encoding="utf-8")
        self.git("add", "release.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)

        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stdout + synced.stderr)
        rebased = self.git("rev-parse", "HEAD")
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(recovery["rebase_input_head"], resolved)
        self.assertEqual(recovery["rebase_synced_head"], rebased)
        self.assertEqual(recovery["rebase_tree"], self.git("rev-parse", "HEAD^{tree}"))
        self.assertEqual(self.git("rev-parse", recovery["rebase_input_ref"]), resolved)
        rollback = run("bash", str(SYNC_SCRIPT), "rollback", "--json", cwd=self.worktree)
        self.assertNotEqual(rollback.returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD"), rebased)
        self.assertTrue(marker.exists())

        final_head = self.commit_followup("review correction")
        recovery["synced_head"] = final_head
        marker.write_text(json.dumps(recovery), encoding="utf-8")
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        after = self.pr_snapshot()
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(after), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        self.git("update-ref", recovery["rebase_input_ref"], old_source)
        false_proof = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertNotEqual(false_proof.returncode, 0)
        self.assertTrue(marker.exists())
        self.git("update-ref", recovery["rebase_input_ref"], resolved)
        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)
        common = Path(self.git("rev-parse", "--git-common-dir"))
        lineage = common / "blue-whale" / "implement-spec-rebase-lineage" / BRANCH.replace("/", "%") / f"{rebased}.json"
        record = json.loads(lineage.read_text(encoding="utf-8"))
        self.assertEqual(record["original_head"], resolved)
        self.assertEqual(record["synced_head"], rebased)
        self.assertEqual(record["verified_head"], final_head)
        rejected = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(after),
                       "--json", cwd=child_root)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertTrue(child_root.exists())

    def test_two_unpublished_release_syncs_preserve_child_cleanup_proof(self) -> None:
        _, child_root = self.implement_spec_child()
        child_head = self.git("rev-parse", "HEAD", cwd=child_root)
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        (self.main / "release.txt").write_text("release\n", encoding="utf-8")
        self.git("add", "release.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        first = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        first_head = self.git("rev-parse", "HEAD")
        self.assertNotEqual(run("git", "merge-base", "--is-ancestor", child_head, first_head,
                                cwd=self.worktree).returncode, 0)
        (self.main / "release-next.txt").write_text("next\n", encoding="utf-8")
        self.git("add", "release-next.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release again", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        second = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        marker = Path(self.git("rev-parse", "--absolute-git-dir")) / "agent-sync-recovery.json"
        recovery = json.loads(marker.read_text(encoding="utf-8"))
        self.assertEqual(len(recovery["rebase_proofs"]), 1)
        self.assertEqual(recovery["rebase_proofs"][0]["synced_head"], first_head)
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        after = self.pr_snapshot()
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(after), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        original_recovery = marker.read_text(encoding="utf-8")
        tampered = json.loads(original_recovery)
        tampered["rebase_tree"] = "0" * 40
        marker.write_text(json.dumps(tampered), encoding="utf-8")
        rejected = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertNotEqual(rejected.returncode, 0)
        common = Path(self.git("rev-parse", "--git-common-dir"))
        lineage_dir = common / "blue-whale" / "implement-spec-rebase-lineage" / BRANCH.replace("/", "%")
        self.assertFalse((lineage_dir / f"{first_head}.json").exists())
        marker.write_text(original_recovery, encoding="utf-8")
        finalized = self.finalize_after_backup_unlock()
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)
        self.assertEqual(len(list(lineage_dir.glob("*.json"))), 2)
        cleaned = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(after),
                      "--json", cwd=child_root)
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(child_root.exists())
        self.assertEqual("child\n", (self.worktree / "child.txt").read_text(encoding="utf-8"))
        self.assertEqual("release\n", (self.worktree / "release.txt").read_text(encoding="utf-8"))
        self.assertEqual("next\n", (self.worktree / "release-next.txt").read_text(encoding="utf-8"))

    def test_linearized_pr_after_release_sync_allows_child_cleanup(self) -> None:
        child_branch, child_root = self.implement_spec_child()
        child_head = self.git("rev-parse", "HEAD", cwd=child_root)
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        rewritten = self.invoke_linearize(before, child_branch, "--user-authorized")
        self.assertEqual(rewritten.returncode, 0, rewritten.stdout + rewritten.stderr)
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)
        after = self.pr_snapshot()
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(after), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)

        (self.main / "release.txt").write_text("release\n", encoding="utf-8")
        self.git("add", "release.txt", cwd=self.main)
        self.git("commit", "-m", "chore: advance release", cwd=self.main)
        self.git("push", "origin", "release/prod", cwd=self.main)
        synced = run("bash", str(SYNC_SCRIPT), "sync", "--json", cwd=self.worktree)
        self.assertEqual(synced.returncode, 0, synced.stdout + synced.stderr)
        self.assertNotEqual(run("git", "merge-base", "--is-ancestor", child_head, "HEAD",
                                cwd=self.worktree).returncode, 0)
        republished = self.invoke_update(after)
        self.assertEqual(republished.returncode, 0, republished.stdout + republished.stderr)
        latest = self.pr_snapshot()
        second_verify = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                            "--pr-snapshot", str(latest), "--json", cwd=self.worktree)
        self.assertEqual(second_verify.returncode, 0, second_verify.stdout + second_verify.stderr)
        second_finalize = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(second_finalize.returncode, 0, second_finalize.stdout + second_finalize.stderr)

        cleaned = run(sys.executable, CLEANUP_CHILD_SCRIPT, "--pr-snapshot", str(latest),
                      "--json", cwd=child_root)
        self.assertEqual(cleaned.returncode, 0, cleaned.stdout + cleaned.stderr)
        self.assertFalse(child_root.exists())
        self.assertEqual("child\n", (self.worktree / "child.txt").read_text(encoding="utf-8"))
        self.assertEqual("release\n", (self.worktree / "release.txt").read_text(encoding="utf-8"))

    def test_linearized_pr_finalize_rejects_readback_of_another_pr(self) -> None:
        child_branch, _ = self.implement_spec_child()
        self.git("push", "origin", BRANCH)
        before = self.pr_snapshot()
        rewritten = self.invoke_linearize(before, child_branch, "--user-authorized")
        self.assertEqual(rewritten.returncode, 0, rewritten.stdout + rewritten.stderr)
        published = self.invoke_update(before)
        self.assertEqual(published.returncode, 0, published.stdout + published.stderr)

        other_pr = self.pr_snapshot(iid=66)
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "66",
                       "--pr-snapshot", str(other_pr), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        rejected = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("PR 编号", str(self.response(rejected)["detail"]))

        correct_pr = self.pr_snapshot()
        verified = run("bash", str(VERIFY_SCRIPT), "--update-pr", "65",
                       "--pr-snapshot", str(correct_pr), "--json", cwd=self.worktree)
        self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
        finalized = run("bash", str(SYNC_SCRIPT), "finalize", "--json", cwd=self.worktree)
        self.assertEqual(finalized.returncode, 0, finalized.stdout + finalized.stderr)

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

        result = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")

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
        env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

        result = subprocess.run(
            [BASH, str(PUBLISH_SCRIPT), "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"],
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
        published = self.invoke("--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json")
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
        env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]

        result = subprocess.run(
            [BASH, str(PUBLISH_SCRIPT), "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"],
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
