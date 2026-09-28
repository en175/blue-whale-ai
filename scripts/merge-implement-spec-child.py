#!/usr/bin/env python3
"""Rebase an unpublished implement-spec child and fast-forward its integration branch."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from lib.task_metadata import (TaskMetadataError, integration_marker_path,
                               metadata_path, read_task_metadata)


class MergeError(RuntimeError):
    pass


def git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True, encoding="utf-8"
    )
    if check and result.returncode:
        raise MergeError(result.stderr.strip() or result.stdout.strip())
    return result


def output(root: Path, *args: str) -> str:
    return git(root, *args).stdout.strip()


def ensure_task_worktree(root: Path) -> dict[str, object]:
    if not root.is_dir():
        raise MergeError(f"任务工作树不存在：{root}")
    git_dir = Path(output(root, "rev-parse", "--absolute-git-dir")).resolve()
    common = Path(output(root, "rev-parse", "--git-common-dir")).resolve()
    if git_dir == common:
        raise MergeError("必须使用独立任务工作树。")
    if output(root, "status", "--porcelain"):
        raise MergeError(f"工作区不干净：{root}")
    for name in ("MERGE_HEAD", "rebase-merge", "rebase-apply"):
        if (git_dir / name).exists():
            raise MergeError(f"工作树存在未完成的 Git 操作：{name}")
    return read_task_metadata(root)


def rebind_inherited_child(child: Path, metadata: dict[str, object], integration_sha: str) -> None:
    path = metadata_path(child)
    marker = integration_marker_path(child)
    if not marker.is_file():
        raise MergeError("子任务缺少开工入口的继承标记；保留恢复引用。")
    original = path.read_text(encoding="utf-8")
    original_marker = marker.read_text(encoding="utf-8")
    if json.loads(original) != metadata or original_marker.strip() != metadata["inherited_sha"]:
        raise MergeError("子任务继承记录在合回期间变化；保留恢复引用。")
    updated = {**metadata, "inherited_sha": integration_sha}

    def replace(target: Path, content: str) -> None:
        fd, temporary = tempfile.mkstemp(prefix="task-integration-", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(content)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    try:
        replace(path, json.dumps(updated, ensure_ascii=False, indent=2) + "\n")
        replace(marker, integration_sha + "\n")
        read_task_metadata(child)
    except (OSError, TaskMetadataError, ValueError) as exc:
        replace(path, original)
        replace(marker, original_marker)
        raise MergeError("更新子任务继承记录失败；保留恢复引用：" + str(exc)) from exc


def merge(root: Path, child: Path) -> dict[str, object]:
    integration = ensure_task_worktree(root)
    child_metadata = ensure_task_worktree(child)
    if root == child:
        raise MergeError("集成与子任务工作树不能相同。")
    if output(root, "rev-parse", "--git-common-dir") != output(child, "rev-parse", "--git-common-dir"):
        raise MergeError("集成与子任务不属于同一仓库。")
    if integration["target_branch"] != child_metadata["target_branch"]:
        raise MergeError("集成与子任务的目标发布线不一致。")

    integration_branch = str(integration["task_branch"])
    child_branch = str(child_metadata["task_branch"])
    integration_sha = output(root, "rev-parse", "HEAD")
    child_sha = output(child, "rev-parse", "HEAD")
    if integration_branch == child_branch:
        raise MergeError("集成与子任务分支不能相同。")
    remote = git(root, "ls-remote", "--heads", "origin", f"refs/heads/{child_branch}")
    if remote.stdout.strip():
        raise MergeError("子任务分支已共享，拒绝改写提交。")
    base = output(root, "merge-base", integration_sha, child_sha)
    if git(root, "merge-base", "--is-ancestor", child_sha, integration_sha, check=False).returncode == 0:
        raise MergeError("子任务提交已进入集成分支。")
    inherited_sha = child_metadata.get("inherited_sha")
    if inherited_sha:
        if inherited_sha == child_metadata["start_sha"]:
            valid_inheritance = git(root, "merge-base", "--is-ancestor", str(inherited_sha),
                                    child_sha, check=False).returncode == 0
        else:
            parents = output(root, "show", "-s", "--format=%P", str(inherited_sha)).split()
            valid_inheritance = (len(parents) == 2 and parents[0] == child_metadata["start_sha"]
                                 and output(root, "rev-list", "--first-parent", "--merges",
                                            f"{child_metadata['start_sha']}..{child_sha}").splitlines()
                                 == [inherited_sha])
        if not valid_inheritance or output(root, "rev-list", "--merges",
                                           f"{inherited_sha}..{child_sha}"):
            raise MergeError("子任务继承历史不符或含其他 merge commit，拒绝受控 rebase。")
        if git(root, "merge-base", "--is-ancestor", str(child_metadata["start_sha"]),
               integration_sha, check=False).returncode:
            raise MergeError("父整合分支尚未包含子任务的发布线起点；先同步父整合分支。")
        replay_base = str(inherited_sha)
    else:
        if output(root, "rev-list", "--merges", f"{base}..{child_sha}"):
            raise MergeError("子任务分支含 merge commit，拒绝受控 rebase。")
        replay_base = base

    expected = git(root, "merge-tree", "--write-tree", integration_sha, child_sha, check=False)
    if expected.returncode and inherited_sha and inherited_sha != child_metadata["start_sha"]:
        old_integration_sha = parents[1]
        inherited_tree = git(root, "merge-tree", "--write-tree",
                             str(child_metadata["start_sha"]), old_integration_sha,
                             check=False)
        inherited_tree_lines = inherited_tree.stdout.splitlines()
        first_parent_trees = output(root, "log", "--first-parent", "--format=%T",
                                    f"{child_metadata['start_sha']}..{integration_sha}").splitlines()
        if (inherited_tree.returncode == 0 and inherited_tree_lines
                and inherited_tree_lines[0] in first_parent_trees):
            expected = git(root, "merge-tree", "--write-tree",
                           f"--merge-base={old_integration_sha}", integration_sha, child_sha,
                           check=False)
    if expected.returncode:
        raise MergeError("子任务与当前集成提交存在合并冲突，未改写分支：" + expected.stdout.strip())
    expected_tree = expected.stdout.splitlines()[0]
    backup_ref = "refs/agent-implement-spec-backups/" + child_branch.replace("/", "%")
    if git(root, "show-ref", "--verify", "--quiet", backup_ref, check=False).returncode == 0:
        raise MergeError(f"已有子任务恢复引用，先核查：{backup_ref}")
    git(root, "update-ref", backup_ref, child_sha, "")

    rebased = git(child, "rebase", "--onto", integration_sha, replay_base, check=False)
    if rebased.returncode:
        aborted = git(child, "rebase", "--abort", check=False)
        if aborted.returncode or output(child, "rev-parse", "HEAD") != child_sha:
            raise MergeError(f"rebase 冲突且自动恢复失败；保留恢复引用 {backup_ref}。")
        raise MergeError(f"rebase 冲突，原提交已恢复；保留恢复引用 {backup_ref}。")
    new_sha = output(child, "rev-parse", "HEAD")
    actual_tree = output(child, "rev-parse", "HEAD^{tree}")
    if actual_tree != expected_tree:
        raise MergeError(
            f"rebase 后文件树与无冲突合并结果不同；集成分支未移动，保留恢复引用 {backup_ref}。"
        )
    if output(child, "rev-list", "--merges", f"{integration_sha}..HEAD"):
        raise MergeError(f"子任务仍含 merge commit；集成分支未移动，保留恢复引用 {backup_ref}。")
    if git(root, "ls-remote", "--heads", "origin", f"refs/heads/{child_branch}").stdout.strip():
        raise MergeError(f"子任务分支在核验期间被共享；集成分支未移动，保留恢复引用 {backup_ref}。")
    if output(root, "rev-parse", "HEAD") != integration_sha or output(root, "status", "--porcelain"):
        raise MergeError(f"集成工作树在核验期间变化；保留恢复引用 {backup_ref}。")

    if inherited_sha:
        rebind_inherited_child(child, child_metadata, integration_sha)
    git(root, "merge", "--ff-only", child_branch)
    if output(root, "rev-parse", "HEAD") != new_sha:
        raise MergeError(f"快进后提交不符；保留恢复引用 {backup_ref}。")
    git(root, "update-ref", "-d", backup_ref, child_sha)
    return {
        "status": "MERGED_FAST_FORWARD",
        "integration_branch": integration_branch,
        "child_branch": child_branch,
        "original_child_head": child_sha,
        "head": new_sha,
        "tree": actual_tree,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--child-worktree", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")
    try:
        root = Path(output(Path.cwd(), "rev-parse", "--show-toplevel")).resolve()
        result = merge(root, args.child_worktree.resolve())
        code = 0
    except (MergeError, TaskMetadataError, subprocess.CalledProcessError, OSError, ValueError) as exc:
        result = {"status": "MERGE_STOPPED", "detail": str(exc)}
        code = 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
