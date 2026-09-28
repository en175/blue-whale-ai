#!/usr/bin/env python3
"""Synchronize a task worktree with a protected PR target as a recoverable transaction."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from sync_recovery import RecoveryError, load_recovery, write_recovery
from lib.task_metadata import TaskMetadataError, read_task_metadata


RECOVERY_FILE = "agent-sync-recovery.json"
BACKUP_PREFIX = "refs/agent-sync-backups/"


class WorkflowError(RuntimeError):
    pass


def git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=check,
    )


def git_output(root: Path, *args: str) -> str:
    return git(root, *args).stdout.strip()


def repository_root() -> Path:
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    if result.returncode != 0:
        raise WorkflowError("当前目录不在 Git 仓库中。")
    return Path(result.stdout.strip()).resolve()


def absolute_git_path(root: Path, argument: str) -> Path:
    value = git_output(root, "rev-parse", argument)
    path = Path(value)
    return path if path.is_absolute() else (root / path).resolve()


def worktree_context(root: Path) -> tuple[Path, str]:
    git_dir = absolute_git_path(root, "--absolute-git-dir")
    common_dir = absolute_git_path(root, "--git-common-dir")
    if git_dir == common_dir:
        raise WorkflowError("同步入口只能在 task worktree 中执行，禁止在主 checkout 运行。")
    branch = git_output(root, "symbolic-ref", "--short", "HEAD")
    validator = Path(__file__).with_name("start-task-worktree.py")
    validation = subprocess.run(
        [sys.executable, str(validator), "--validate-branch", branch],
        text=True,
        encoding="utf-8",
        capture_output=True,
    )
    if validation.returncode != 0:
        detail = validation.stderr.strip() or validation.stdout.strip()
        raise WorkflowError("当前分支不是结构化任务分支：{}；{}".format(branch, detail))
    return git_dir, branch


def ensure_clean(root: Path) -> None:
    if git_output(root, "status", "--porcelain"):
        raise WorkflowError("工作区不干净；同步或恢复前请先提交或处理改动。")


def ensure_no_git_operation(git_dir: Path) -> None:
    names = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
    active = [name for name in names if (git_dir / name).exists()]
    if active:
        raise WorkflowError("检测到进行中的 Git 操作：{}".format(", ".join(active)))


def recovery_paths(git_dir: Path, branch: str) -> tuple[Path, str]:
    return git_dir / RECOVERY_FILE, BACKUP_PREFIX + branch.replace("/", "%")


def lineage_paths(root: Path, branch: str) -> tuple[Path, str]:
    common = absolute_git_path(root, "--git-common-dir")
    slug = branch.replace("/", "%")
    return (common / "blue-whale" / "implement-spec-lineage" / f"{slug}.json",
            "refs/agent-implement-spec-lineage/" + slug)


def rebase_lineage_paths(root: Path, branch: str, synced_head: str) -> tuple[Path, str]:
    common = absolute_git_path(root, "--git-common-dir")
    slug = branch.replace("/", "%")
    return (common / "blue-whale" / "implement-spec-rebase-lineage" / slug / f"{synced_head}.json",
            f"refs/agent-implement-spec-rebase-lineage/{slug}/{synced_head}")


def current_rebase_proof(recovery: dict[str, object]) -> dict[str, str] | None:
    if not recovery.get("rebase_tree"):
        return None
    return {
        "original_head": str(recovery.get("rebase_input_head", recovery["original_head"])),
        "upstream_sha": str(recovery.get("rebase_upstream_sha", recovery["upstream_sha"])),
        "synced_head": str(recovery.get("rebase_synced_head", recovery["synced_head"])),
        "merged_tree": str(recovery["rebase_tree"]),
        "input_ref": str(recovery.get("rebase_input_ref", "")),
    }


def verify_rebase_proof(root: Path, proof: dict[str, str], continuation: str) -> None:
    original = proof["original_head"]
    upstream = proof["upstream_sha"]
    synced = proof["synced_head"]
    tree = proof["merged_tree"]
    retained = proof.get("input_ref", "")
    expected = git(root, "merge-tree", "--write-tree", upstream, original, check=False)
    if (not all(re.fullmatch(r"[0-9a-f]{40}", value)
                for value in (original, upstream, synced, tree))
            or expected.returncode or not expected.stdout.splitlines()
            or expected.stdout.splitlines()[0] != tree
            or git_output(root, "rev-parse", f"{synced}^{{tree}}") != tree
            or (retained and git_output(root, "rev-parse", retained) != original)
            or git(root, "merge-base", "--is-ancestor", synced,
                   continuation, check=False).returncode):
        raise WorkflowError("同步证明未通过输入引用、合并文件树或提交接续核对。")


def integrated_child_heads(root: Path, branch: str, target_branch: str,
                           original_head: str) -> dict[str, str]:
    children = {}
    worktree = None
    for line in git_output(root, "worktree", "list", "--porcelain").splitlines() + [""]:
        if line.startswith("worktree "):
            worktree = Path(line[9:]).resolve()
        elif not line and worktree is not None:
            if worktree != root:
                try:
                    metadata = read_task_metadata(worktree, target_branch)
                except (TaskMetadataError, OSError):
                    metadata = None
                if metadata and metadata["task_branch"] != branch:
                    child_head = git_output(worktree, "rev-parse", "HEAD")
                    if git(root, "merge-base", "--is-ancestor", child_head,
                           original_head, check=False).returncode == 0:
                        children[str(metadata["task_branch"])] = child_head
            worktree = None
    return children


def _legacy_polluted_branch(candidate: str, real: str) -> bool:
    """兼容旧版脚本（PR577 前）写入的 GBK 乱码分支名。

    旧版 git() 未指定 encoding，subprocess 在 Windows 用 locale(GBK) 解码
    git 输出的 UTF-8 字节，得到的乱码 str 被 ensure_ascii=False 原样写入恢复点。
    还原方向：乱码 str.encode("gbk") 恰好等于真实 UTF-8 字节，再 decode("utf-8")
    即得真实分支名。仅当候选恰是这类乱码且还原后等于 real 才放行；
    其余情况（含 POSIX、合法中文名、非乱码）保持原比较语义。
    """
    if candidate == real:
        return True
    try:
        return candidate.encode("gbk").decode("utf-8") == real
    except UnicodeError:
        return False


def read_recovery(path: Path, branch: str) -> dict[str, object]:
    if not path.exists():
        raise WorkflowError("当前 worktree 没有可用的同步恢复点。")
    try:
        payload = load_recovery(path)
    except RecoveryError as exc:
        raise WorkflowError("同步恢复点无法读取：{}".format(exc)) from exc
    if not _legacy_polluted_branch(str(payload.get("branch", "")), branch):
        raise WorkflowError("同步恢复点属于其他分支，拒绝使用。")
    return payload


def remote_branch_sha(root: Path, branch: str) -> str:
    result = git(root, "ls-remote", "--heads", "origin", "refs/heads/{}".format(branch), check=False)
    if result.returncode != 0:
        raise WorkflowError("无法读取远端源分支状态：{}".format(result.stderr.strip()))
    return result.stdout.split()[0] if result.stdout.strip() else ""


def remove_recovery(root: Path, marker: Path, backup_ref: str) -> None:
    deleted = git(root, "update-ref", "-d", backup_ref, check=False)
    if deleted.returncode != 0:
        raise WorkflowError(
            "无法删除同步 backup ref，恢复记录已保留：{}".format(
                deleted.stderr.strip() or deleted.stdout.strip()
            )
        )
    marker.unlink(missing_ok=True)


def pending_recovery(root: Path, marker: Path, branch: str, target_branch: str,
                     current_head: str, backup_ref: str) -> dict[str, object]:
    recovery = read_recovery(marker, branch)
    if recovery.get("target_branch", "master") != target_branch:
        raise WorkflowError("已有同步事务绑定其他 PR 目标分支，拒绝切换基线。")
    if recovery.get("pushed_head") or recovery.get("push_state"):
        raise WorkflowError("上一轮同步结果已进入推送阶段；完成远端核验并 finalize 后才能继续。")
    if recovery.get("rebase_tree_failed"):
        raise WorkflowError("上一轮同步的文件树核对失败；保留恢复点，禁止覆盖失败证据。")
    if recovery.get("synced_head"):
        retained = git(root, "rev-parse", "--verify", str(recovery.get("backup_ref", backup_ref)),
                       check=False)
        if retained.returncode or retained.stdout.strip() != recovery["original_head"]:
            raise WorkflowError("同步 backup ref 与原始提交不符，拒绝覆盖恢复点。")
    expected_head = str(recovery.get("synced_head", recovery["original_head"]))
    if current_head != expected_head:
        if git(root, "merge-base", "--is-ancestor", expected_head, current_head,
               check=False).returncode:
            raise WorkflowError("当前 HEAD 已离开已有同步事务，拒绝覆盖恢复点。")
        if git_output(root, "rev-list", "--merges", f"{expected_head}..{current_head}"):
            raise WorkflowError("同步后的修订含 merge commit，拒绝更新恢复点。")
        if recovery.get("linearized_pr"):
            changed = set(git_output(root, "diff", "--name-only",
                                     f"{expected_head}..{current_head}").splitlines())
            if changed - set(recovery["frozen_files"]):
                raise WorkflowError("线性化后的修订超出 PR 冻结文件范围，拒绝更新恢复点。")
    if remote_branch_sha(root, branch) != recovery.get("remote_branch_sha", ""):
        raise WorkflowError("远端源分支变化，拒绝更新同步恢复点。")
    proofs = recovery.get("rebase_proofs", [])
    if not isinstance(proofs, list) or any(not isinstance(item, dict) for item in proofs):
        raise WorkflowError("多轮同步证明格式错误，拒绝覆盖恢复点。")
    proofs = list(proofs)
    current_proof = current_rebase_proof(recovery)
    if current_proof:
        proofs.append(current_proof)
    for index, proof in enumerate(proofs):
        continuation = str(proofs[index + 1]["original_head"]) if index + 1 < len(proofs) else current_head
        verify_rebase_proof(root, proof, continuation)
    if current_head != expected_head:
        recovery["synced_head"] = current_head
        recovery["rollback_safe"] = False
    return recovery


def emit(as_json: bool, status: str, **details: object) -> None:
    payload = {"status": status, **details}
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    else:
        print("{}: {}".format(status, json.dumps(details, ensure_ascii=False, sort_keys=True)))


def synchronize(root: Path, as_json: bool, target_branch: str | None) -> int:
    git_dir, branch = worktree_context(root)
    metadata = read_task_metadata(root, target_branch)
    if metadata.get("inherited_sha"):
        raise WorkflowError("整包子票不能独立同步；请在父整合工作树同步并发布整包 PR。")
    target_branch = metadata["target_branch"]
    start_sha = metadata["start_sha"]
    ensure_clean(root)
    ensure_no_git_operation(git_dir)
    upstream_ref = "origin/{}".format(target_branch)
    fetch = git(root, "fetch", "origin", target_branch, check=False)
    if fetch.returncode != 0:
        raise WorkflowError("fetch {} 失败：{}".format(upstream_ref, fetch.stderr.strip()))

    upstream_sha = git_output(root, "rev-parse", upstream_ref)
    remote_target = git_output(root, "ls-remote", "--heads", "origin", "refs/heads/{}".format(target_branch))
    if not remote_target or remote_target.split()[0] != upstream_sha:
        raise WorkflowError("远端目标在 fetch 后变化；重新读取并同步。")
    if git(root, "merge-base", "--is-ancestor", start_sha, upstream_sha, check=False).returncode != 0:
        pending = git_output(root, "log", "--format=%h %s", "--reverse", "{}..{}".format(upstream_sha, start_sha))
        raise WorkflowError("origin/{} 尚未包含任务起点 {}；待共享基线提交：\n{}".format(target_branch, start_sha, pending))
    original_head = git_output(root, "rev-parse", "HEAD")
    marker, backup_ref = recovery_paths(git_dir, branch)
    recovery = (pending_recovery(root, marker, branch, target_branch, original_head, backup_ref)
                if marker.exists() else None)
    if git(root, "merge-base", "--is-ancestor", upstream_sha, original_head, check=False).returncode == 0:
        if recovery and recovery.get("synced_head") == original_head:
            write_recovery(marker, recovery)
        emit(
            as_json,
            "UP_TO_DATE",
            branch=branch,
            head=original_head,
            upstream_sha=upstream_sha,
            target_branch=target_branch,
            recovery_available=marker.exists(),
        )
        return 0

    rebase_input_head = original_head
    if recovery:
        expected_head = str(recovery.get("synced_head", recovery["original_head"]))
        proofs = recovery.get("rebase_proofs", [])
        current_proof = current_rebase_proof(recovery)
        if current_proof:
            recovery["rebase_proofs"] = [*proofs, current_proof]
        for field in ("rebase_tree", "rebase_synced_head", "rebase_upstream_sha"):
            recovery.pop(field, None)
        recovery.setdefault("rollback_safe", recovery.get("rebase_input_head")
                            == recovery["original_head"])
        rebase_input_head = expected_head
        backup_ref = str(recovery.get("backup_ref", backup_ref))
        remote_sha = str(recovery.get("remote_branch_sha", ""))
        # 旧版脚本（PR577 前）可能写入 GBK 乱码的 branch 字段；read_recovery 已兼容放行，
        # 这里归一化为实时真实分支名并随 write_recovery 写回，确保下游（如
        # publish-review-package.sh --update-pr 的严格比较）读到的始终是真实 UTF-8 名。
        recovery["branch"] = branch
        recovery["upstream_sha"] = upstream_sha
    else:
        remote_sha = remote_branch_sha(root, branch)
        git(root, "update-ref", backup_ref, original_head)
        recovery = {
            "version": 1,
            "branch": branch,
            "original_head": original_head,
            "upstream_sha": upstream_sha,
            "target_branch": target_branch,
            "remote_branch_sha": remote_sha,
            "backup_ref": backup_ref,
            "rollback_safe": True,
            "created_at": int(time.time()),
        }
    input_ref = "refs/agent-sync-inputs/" + branch.replace("/", "%") + "/" + rebase_input_head
    retained_input = git(root, "rev-parse", "--verify", input_ref, check=False)
    if retained_input.returncode == 0 and retained_input.stdout.strip() != rebase_input_head:
        raise WorkflowError("本轮同步输入保留引用与恢复点不符，拒绝覆盖。")
    git(root, "update-ref", input_ref, rebase_input_head)
    recovery["rebase_input_head"] = rebase_input_head
    recovery["rebase_input_ref"] = input_ref
    recovery.setdefault("child_heads", integrated_child_heads(root, branch, target_branch,
                                                                str(recovery["original_head"])))
    write_recovery(marker, recovery)

    rebase = git(root, "rebase", upstream_ref, check=False)
    if rebase.returncode != 0:
        conflicts = git_output(root, "diff", "--name-only", "--diff-filter=U").splitlines()
        rebase_head_probe = git(root, "rev-parse", "--verify", "REBASE_HEAD", check=False)
        rebase_head = rebase_head_probe.stdout.strip() if rebase_head_probe.returncode == 0 else ""
        abort = git(root, "rebase", "--abort", check=False)
        restored_head = git_output(root, "rev-parse", "HEAD")
        if abort.returncode != 0 or restored_head != original_head:
            raise WorkflowError(
                "rebase 冲突且自动 abort 未能恢复原 HEAD；abort 输出：{}".format(abort.stderr.strip())
            )
        recovery["rollback_safe"] = False
        write_recovery(marker, recovery)
        emit(
            as_json,
            "REBASE_CONFLICT_ABORTED",
            branch=branch,
            original_head=original_head,
            upstream_sha=upstream_sha,
            target_branch=target_branch,
            remote_branch_sha=remote_sha,
            replaying_commit=rebase_head,
            conflict_files=conflicts,
            recovery_file=str(marker),
            backup_ref=backup_ref,
        )
        return 3

    synced_head = git_output(root, "rev-parse", "HEAD")
    recovery["synced_head"] = synced_head
    recovery["rebase_input_head"] = rebase_input_head
    recovery["rebase_synced_head"] = synced_head
    recovery["rebase_upstream_sha"] = upstream_sha
    recovery.pop("rebase_tree", None)
    recovery.pop("rebase_tree_failed", None)
    rebase_lineage_dir = rebase_lineage_paths(root, branch, synced_head)[0].parent
    linearized_lineage = lineage_paths(root, branch)[0]
    if recovery["child_heads"] or rebase_lineage_dir.is_dir() or linearized_lineage.is_file():
        expected = git(root, "merge-tree", "--write-tree", upstream_sha,
                       rebase_input_head, check=False)
        if (expected.returncode == 0 and expected.stdout.splitlines()
                and expected.stdout.splitlines()[0] == git_output(root, "rev-parse", "HEAD^{tree}")
                and not git_output(root, "rev-list", "--merges", f"{upstream_sha}..HEAD")):
            recovery["rebase_tree"] = expected.stdout.splitlines()[0]
        else:
            recovery["rebase_tree_failed"] = True
    write_recovery(marker, recovery)
    if recovery.get("rebase_tree_failed"):
        emit(as_json, "VERIFICATION_FAILED", branch=branch, head=synced_head,
             recovery_file=str(marker), detail="子任务合回后的同步文件树与无冲突合并结果不一致；禁止发布。")
        return 4
    diff_check = git(root, "diff", "--check", "{}...HEAD".format(upstream_ref), check=False)
    if diff_check.returncode != 0:
        emit(
            as_json,
            "VERIFICATION_FAILED",
            branch=branch,
            head=synced_head,
            recovery_file=str(marker),
            detail=diff_check.stdout.strip() or diff_check.stderr.strip(),
        )
        return 4
    emit(
        as_json,
        "SYNCED",
        branch=branch,
        original_head=original_head,
        head=synced_head,
        upstream_sha=upstream_sha,
        target_branch=target_branch,
        remote_branch_sha=remote_sha,
        recovery_file=str(marker),
        backup_ref=backup_ref,
    )
    return 0


def _worktree_for_branch(root: Path, branch: str) -> Path:
    worktree = None
    current_path = None
    for line in git_output(root, "worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            current_path = Path(line[9:])
        elif line == f"branch refs/heads/{branch}":
            worktree = current_path
    if worktree is None:
        raise WorkflowError(f"找不到子任务 {branch} 的工作树，无法证明 merge commit 来源。")
    return worktree


def linearize(
    root: Path, as_json: bool, authorized: bool, iid: int | None,
    snapshot_path: Path | None, child_branches: list[str],
) -> int:
    if not authorized or iid is None or snapshot_path is None:
        raise WorkflowError("线性化已发布 PR 需要本轮明确更新授权、--update-pr 和 --pr-snapshot。")
    git_dir, branch = worktree_context(root)
    metadata = read_task_metadata(root)
    ensure_clean(root)
    ensure_no_git_operation(git_dir)
    marker, backup_ref = recovery_paths(git_dir, branch)
    if marker.exists() or git(root, "show-ref", "--verify", "--quiet", backup_ref, check=False).returncode == 0:
        raise WorkflowError("已有同步恢复点或 backup ref；先核查并完成现有事务。")

    target_branch = str(metadata["target_branch"])
    fetch = git(root, "fetch", "origin", target_branch, check=False)
    if fetch.returncode:
        raise WorkflowError(f"无法读取 origin/{target_branch}：{fetch.stderr.strip()}")
    upstream_sha = git_output(root, "rev-parse", f"origin/{target_branch}")
    target_line = git_output(root, "ls-remote", "--heads", "origin", f"refs/heads/{target_branch}")
    if not target_line or target_line.split()[0] != upstream_sha:
        raise WorkflowError("目标发布线在 fetch 后变化，停止线性化。")
    original_head = git_output(root, "rev-parse", "HEAD")
    if git(root, "merge-base", "--is-ancestor", upstream_sha, original_head, check=False).returncode:
        raise WorkflowError("PR 源分支尚未包含当前目标发布线；先核对基线，不能直接线性化。")
    if git(root, "merge-base", "--is-ancestor", str(metadata["start_sha"]), upstream_sha,
           check=False).returncode:
        raise WorkflowError("远端目标发布线尚未包含任务起点，停止线性化。")
    remote_sha = remote_branch_sha(root, branch)
    if remote_sha != original_head:
        raise WorkflowError("本地 HEAD 与已发布 PR 源分支不一致，拒绝覆盖未知远端提交。")

    preflight = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("pr-update-evidence.py")),
         "preflight", "--update-pr", str(iid), "--pr-snapshot", str(snapshot_path),
         "--remote-sha", remote_sha, "--json"],
        cwd=root, text=True, encoding="utf-8", capture_output=True,
    )
    if preflight.returncode:
        raise WorkflowError("PR 快照预检未通过：" + (preflight.stdout.strip() or preflight.stderr.strip()))
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    if snapshot["target_branch"] != target_branch:
        raise WorkflowError("PR 目标与任务元数据不一致。")
    frozen_files = set(snapshot["changed_files"])
    current_files = set(git_output(root, "diff", "--name-only", f"origin/{target_branch}...HEAD").splitlines())
    if current_files != frozen_files:
        raise WorkflowError("PR 快照文件范围与当前源分支不一致。")

    commit_range = f"{upstream_sha}..{original_head}"
    merges = git_output(root, "rev-list", "--merges", commit_range).splitlines()
    first_parent_merges = git_output(root, "rev-list", "--first-parent", "--merges", commit_range).splitlines()
    if not first_parent_merges:
        raise WorkflowError("PR 集成分支没有可核对的子任务合回提交。")
    if len(child_branches) != len(first_parent_merges) or len(set(child_branches)) != len(child_branches):
        raise WorkflowError("必须为每个 merge commit 指定唯一的 --child-branch。")
    child_tips = {}
    child_metadata = {}
    for child_branch in child_branches:
        if not re.match(r"^(feature|fix|hotfix|docs|chore)/[^/]+$", child_branch) or child_branch == branch:
            raise WorkflowError(f"子任务分支名无效：{child_branch}")
        child_root = _worktree_for_branch(root, child_branch)
        child_meta = read_task_metadata(child_root, target_branch)
        if child_meta["task_branch"] != child_branch:
            raise WorkflowError(f"子任务元数据不匹配：{child_branch}")
        child_tips[child_branch] = git_output(root, "rev-parse", f"refs/heads/{child_branch}")
        child_metadata[child_branch] = child_meta
    if len(set(child_tips.values())) != len(child_tips):
        raise WorkflowError("多个子任务分支指向同一提交，无法逐一核对合回来源。")
    second_parents = []
    for merge_sha in first_parent_merges:
        parents = git_output(root, "show", "-s", "--format=%P", merge_sha).split()
        if len(parents) != 2 or parents[1] not in child_tips.values():
            raise WorkflowError(f"无法证明 merge commit 属于指定子任务：{merge_sha}")
        second_parents.append(parents[1])
    if set(second_parents) != set(child_tips.values()):
        raise WorkflowError("子任务提交与 merge commit 未一一对应。")
    inherited_merges = set(merges) - set(first_parent_merges)
    inherited_by_branch = {
        child_branch: str(child_meta["inherited_sha"])
        for child_branch, child_meta in child_metadata.items() if child_meta.get("inherited_sha")
    }
    if len(set(inherited_by_branch.values())) != len(inherited_by_branch):
        raise WorkflowError("多个子任务共用同一继承提交，无法逐一核对来源。")
    if inherited_merges != (set(inherited_by_branch.values()) & set(merges)):
        raise WorkflowError("PR 含无法对应子任务继承记录的 merge commit。")
    first_parent_history = set(git_output(root, "rev-list", "--first-parent", commit_range).splitlines())
    first_parent_history.add(upstream_sha)
    for child_branch, inherited_sha in inherited_by_branch.items():
        if inherited_sha not in inherited_merges:
            continue
        parents = git_output(root, "show", "-s", "--format=%P", inherited_sha).split()
        if (len(parents) != 2 or parents[0] != child_metadata[child_branch]["start_sha"]
                or parents[1] not in first_parent_history
                or git(root, "merge-base", "--is-ancestor", inherited_sha,
                       child_tips[child_branch], check=False).returncode):
            raise WorkflowError(f"子任务继承提交无法核对：{child_branch}")
    for commit_sha in git_output(root, "rev-list", "--no-merges", commit_range).splitlines():
        paths = set(git_output(root, "diff-tree", "--no-commit-id", "--name-only", "-r", commit_sha).splitlines())
        if paths - frozen_files:
            raise WorkflowError(f"提交 {commit_sha} 涉及 PR 冻结范围外文件：{', '.join(sorted(paths - frozen_files))}")

    tree = git_output(root, "rev-parse", "HEAD^{tree}")
    git(root, "update-ref", backup_ref, original_head, "")
    recovery = {
        "version": 1, "branch": branch, "original_head": original_head,
        "upstream_sha": upstream_sha, "target_branch": target_branch,
        "remote_branch_sha": remote_sha, "backup_ref": backup_ref,
        "created_at": int(time.time()), "linearized_pr": iid,
        "frozen_files": sorted(frozen_files),
        "original_tree": tree, "child_heads": child_tips,
    }
    write_recovery(marker, recovery)
    commit = subprocess.run(
        ["git", "-C", str(root), "commit-tree", tree, "-p", upstream_sha],
        input=f"chore: linearize implement-spec PR !{iid}\n",
        text=True, encoding="utf-8", capture_output=True,
    )
    if commit.returncode:
        raise WorkflowError("无法建立线性提交，恢复点已保留：" + commit.stderr.strip())
    new_head = commit.stdout.strip()
    git(root, "reset", "--keep", new_head)
    if git_output(root, "rev-parse", "HEAD^{tree}") != tree:
        raise WorkflowError("线性化前后文件树不同；恢复点已保留，禁止推送。")
    if git_output(root, "rev-list", "--merges", f"{upstream_sha}..HEAD"):
        raise WorkflowError("线性化后仍有 merge commit；恢复点已保留，禁止推送。")
    recovery["synced_head"] = new_head
    recovery["linearized_head"] = new_head
    write_recovery(marker, recovery)
    verification = subprocess.run(
        ["node", str(root / "scripts/verify-change-scope.mjs"), "run", "--stage", "pr"],
        cwd=root, text=True, encoding="utf-8", capture_output=True,
    )
    if verification.returncode:
        emit(as_json, "VERIFICATION_FAILED", head=new_head, recovery_file=str(marker),
             detail=verification.stdout.strip() or verification.stderr.strip())
        return 4
    if remote_branch_sha(root, branch) != remote_sha:
        raise WorkflowError("验证期间远端源分支已变化；恢复点已保留，禁止推送。")
    emit(as_json, "LINEARIZED", branch=branch, original_head=original_head,
         head=new_head, tree=tree, recovery_file=str(marker),
         remote_branch_sha=remote_sha, review_required=True)
    return 0


def rollback(root: Path, as_json: bool) -> int:
    git_dir, branch = worktree_context(root)
    if read_task_metadata(root).get("inherited_sha"):
        raise WorkflowError("整包子票不能独立运行任务同步入口；请在父整合工作树操作。")
    ensure_clean(root)
    ensure_no_git_operation(git_dir)
    marker, backup_ref = recovery_paths(git_dir, branch)
    recovery = read_recovery(marker, branch)
    if recovery.get("pushed_head") or recovery.get("push_state"):
        raise WorkflowError("同步后的 HEAD 已进入推送阶段；禁止自动 rollback，请先完成远端核验与人工决策。")
    if not recovery.get("rollback_safe", recovery.get("rebase_input_head")
                        == recovery["original_head"]):
        raise WorkflowError("多轮同步含已解决冲突的中间提交；禁止自动回退到旧 PR 源，已保留恢复点与输入引用。")
    original_head = str(recovery["original_head"])
    current_head = git_output(root, "rev-parse", "HEAD")
    synced_head = str(recovery.get("synced_head", original_head))
    if current_head not in {original_head, synced_head}:
        raise WorkflowError("当前 HEAD 已离开同步事务，拒绝自动 rollback。")
    if current_head != original_head:
        reset = git(root, "reset", "--keep", original_head, check=False)
        if reset.returncode != 0:
            raise WorkflowError("rollback 失败：{}".format(reset.stderr.strip()))
    remove_recovery(root, marker, backup_ref)
    emit(as_json, "ROLLED_BACK", branch=branch, head=original_head)
    return 0


def finalize(root: Path, as_json: bool) -> int:
    git_dir, branch = worktree_context(root)
    if read_task_metadata(root).get("inherited_sha"):
        raise WorkflowError("整包子票不能独立运行任务同步入口；请在父整合工作树操作。")
    ensure_clean(root)
    ensure_no_git_operation(git_dir)
    marker, backup_ref = recovery_paths(git_dir, branch)
    recovery = read_recovery(marker, branch)
    if recovery.get("rebase_tree_failed"):
        raise WorkflowError("同步后的文件树核对失败，禁止 finalize。")
    current_head = git_output(root, "rev-parse", "HEAD")
    if recovery.get("push_state") != "pushed" or recovery.get("pushed_head") != current_head:
        raise WorkflowError("同步事务尚未推送当前 HEAD，禁止 finalize。")
    if recovery.get("verified_head") != current_head:
        raise WorkflowError("当前 HEAD 尚未通过 Gitee PR 远端核验，禁止 finalize。")
    if recovery.get("linearized_pr"):
        if recovery.get("verified_pr_iid") != recovery["linearized_pr"]:
            raise WorkflowError("Gitee 回读的 PR 编号与线性化的 PR 不一致，禁止 finalize。")
        linearized_head = str(recovery["linearized_head"])
        original_head = str(recovery["original_head"])
        original_tree = str(recovery["original_tree"])
        if git_output(root, "rev-parse", f"{original_head}^{{tree}}") != original_tree:
            raise WorkflowError("原 PR 源提交的文件树与线性化记录不符。")
        if git_output(root, "rev-parse", f"{linearized_head}^{{tree}}") != original_tree:
            raise WorkflowError("线性化提交的文件树与原 PR 源提交不一致。")
        if git(root, "merge-base", "--is-ancestor", linearized_head, current_head,
               check=False).returncode or remote_branch_sha(root, branch) != current_head:
            raise WorkflowError("已核验 PR HEAD 未保留线性化提交，或远端源分支再次变化。")
        lineage_file, lineage_ref = lineage_paths(root, branch)
        lineage = {
            "version": 1, "source_branch": branch,
            "target_branch": recovery["target_branch"],
            "pull_request_id": recovery["linearized_pr"],
            "original_head": original_head,
            "original_tree": original_tree,
            "linearized_head": linearized_head,
            "verified_head": current_head,
            "child_heads": recovery["child_heads"],
        }
        if lineage_file.exists():
            if load_recovery(lineage_file) != lineage:
                raise WorkflowError("已有不同的 implement-spec 线性化核验记录。")
            if git_output(root, "rev-parse", lineage_ref) != original_head:
                raise WorkflowError("implement-spec 线性化保留引用与记录不符。")
        else:
            if git(root, "show-ref", "--verify", "--quiet", lineage_ref,
                   check=False).returncode == 0:
                if git_output(root, "rev-parse", lineage_ref) != original_head:
                    raise WorkflowError("implement-spec 线性化保留引用与原 PR 源提交不符。")
            else:
                git(root, "update-ref", lineage_ref, original_head)
            lineage_file.parent.mkdir(parents=True, exist_ok=True)
            write_recovery(lineage_file, lineage)
    proofs = recovery.get("rebase_proofs", [])
    if not isinstance(proofs, list) or any(not isinstance(item, dict) for item in proofs):
        raise WorkflowError("多轮同步证明格式错误，禁止 finalize。")
    current_proof = current_rebase_proof(recovery)
    if current_proof:
        proofs.append(current_proof)
    if proofs and remote_branch_sha(root, branch) != current_head:
        raise WorkflowError("远端 PR 源分支已变化，禁止归档同步证明。")
    for index, proof in enumerate(proofs):
        continuation = str(proofs[index + 1]["original_head"]) if index + 1 < len(proofs) else current_head
        verify_rebase_proof(root, proof, continuation)
    for index, proof in enumerate(proofs):
        continuation = str(proofs[index + 1]["original_head"]) if index + 1 < len(proofs) else current_head
        original_head = str(proof["original_head"])
        synced_head = str(proof["synced_head"])
        lineage_file, lineage_ref = rebase_lineage_paths(root, branch, synced_head)
        lineage = {
            "version": 1, "proof_kind": "rebase", "source_branch": branch,
            "target_branch": recovery["target_branch"],
            "pull_request_id": recovery["verified_pr_iid"],
            "original_head": original_head, "upstream_sha": proof["upstream_sha"],
            "synced_head": synced_head, "verified_head": continuation,
            "merged_tree": proof["merged_tree"],
            "child_heads": recovery["child_heads"],
        }
        if lineage_file.exists():
            if load_recovery(lineage_file) != lineage or git_output(root, "rev-parse", lineage_ref) != original_head:
                raise WorkflowError("已有不同的 implement-spec 同步证明，禁止覆盖。")
        else:
            if git(root, "show-ref", "--verify", "--quiet", lineage_ref, check=False).returncode == 0:
                if git_output(root, "rev-parse", lineage_ref) != original_head:
                    raise WorkflowError("implement-spec 同步保留引用与原提交不符。")
            else:
                git(root, "update-ref", lineage_ref, original_head)
            lineage_file.parent.mkdir(parents=True, exist_ok=True)
            write_recovery(lineage_file, lineage)
    remove_recovery(root, marker, str(recovery.get("backup_ref", backup_ref)))
    emit(as_json, "FINALIZED", branch=branch, head=current_head)
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("sync", "linearize", "rollback", "finalize"))
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--target-branch")
    parser.add_argument("--user-authorized", action="store_true")
    parser.add_argument("--update-pr", type=int)
    parser.add_argument("--pr-snapshot", type=Path)
    parser.add_argument("--child-branch", action="append", default=[])
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    # Windows 原生 Python 的 stdout/stderr 默认 GBK，emit() 的 ensure_ascii=False
    # 中文输出会抛 UnicodeEncodeError（与 subprocess 解码同根因的输出方向）。
    # 强制改 UTF-8；POSIX 本就 UTF-8，reconfigure 为 no-op，不影响其他操作系统。
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    args = parse_args(argv or sys.argv[1:])
    try:
        root = repository_root()
        if args.action == "sync":
            return synchronize(root, args.as_json, args.target_branch)
        if args.action == "linearize":
            if args.target_branch is not None:
                raise WorkflowError("线性化目标分支由任务元数据和 PR 快照决定，请勿传 --target-branch。")
            return linearize(root, args.as_json, args.user_authorized, args.update_pr,
                             args.pr_snapshot, args.child_branch)
        if args.action == "rollback":
            return rollback(root, args.as_json)
        return finalize(root, args.as_json)
    except (RecoveryError, TaskMetadataError, WorkflowError, subprocess.CalledProcessError,
            OSError, ValueError) as exc:
        emit(args.as_json, "ERROR", detail=str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
