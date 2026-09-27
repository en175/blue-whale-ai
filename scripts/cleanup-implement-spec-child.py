#!/usr/bin/env python3
"""Remove a child worktree after its commit is present in the verified remote PR source."""

from __future__ import annotations

import argparse
import json
import re
import runpy
import subprocess
import sys
from pathlib import Path

from lib.task_metadata import read_task_metadata
from sync_recovery import load_recovery


class CleanupError(RuntimeError):
    pass


def git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", "-C", str(root), *args], text=True, encoding="utf-8", capture_output=True
    )
    if check and result.returncode:
        raise CleanupError(result.stderr.strip() or result.stdout.strip())
    return result


def output(root: Path, *args: str) -> str:
    return git(root, *args).stdout.strip()


def worktrees(root: Path) -> list[tuple[Path, str]]:
    entries = []
    path = None
    branch = ""
    for line in output(root, "worktree", "list", "--porcelain").splitlines() + [""]:
        if line.startswith("worktree "):
            path = Path(line[9:]).resolve()
        elif line.startswith("branch "):
            branch = line.removeprefix("branch refs/heads/")
        elif not line and path is not None:
            entries.append((path, branch))
            path = None
            branch = ""
    return entries


def cleanup(root: Path, snapshot_path: Path) -> dict[str, str]:
    git_dir = Path(output(root, "rev-parse", "--absolute-git-dir")).resolve()
    common_dir = Path(output(root, "rev-parse", "--git-common-dir")).resolve()
    if git_dir == common_dir:
        raise CleanupError("必须在子任务 worktree 中执行。")
    child = read_task_metadata(root)
    child_branch = str(child["task_branch"])
    child_head = output(root, "rev-parse", "HEAD")
    if output(root, "status", "--porcelain"):
        raise CleanupError("子任务工作区不干净，未清理。")
    if any((git_dir / name).exists() for name in ("MERGE_HEAD", "rebase-merge", "rebase-apply")):
        raise CleanupError("子任务存在未完成的 Git 操作，未清理。")

    snapshot_loader = runpy.run_path(str(Path(__file__).with_name("pr-update-evidence.py")))
    snapshot = snapshot_loader["load_snapshot"](snapshot_path)
    source_branch = str(snapshot["source_branch"])
    target_branch = str(snapshot["target_branch"])
    source_head = str(snapshot["head_sha"])
    if snapshot["state"] != "opened" or not re.fullmatch(r"[0-9a-f]{40}", source_head):
        raise CleanupError("PR 快照必须是已开放且带有效源 HEAD 的记录。")
    if source_branch == child_branch or target_branch != child["target_branch"]:
        raise CleanupError("PR 源分支或目标发布线与子任务记录不符。")
    entries = worktrees(root)
    integration_roots = [path for path, branch in entries if branch == source_branch]
    if len(integration_roots) != 1:
        raise CleanupError("找不到唯一的 PR 集成任务 worktree。")
    integration = read_task_metadata(integration_roots[0], target_branch)
    if integration["task_branch"] != source_branch:
        raise CleanupError("PR 集成任务元数据不符。")

    fetched = git(root, "fetch", "--no-tags", "origin", f"refs/heads/{source_branch}", check=False)
    if fetched.returncode:
        raise CleanupError("无法读取远端 PR 源分支，未清理：" + fetched.stderr.strip())
    fetched_head = output(root, "rev-parse", "FETCH_HEAD^{commit}")
    if fetched_head != source_head:
        raise CleanupError("PR 快照与远端源分支 HEAD 不一致，未清理。")
    direct_ancestor = git(root, "merge-base", "--is-ancestor", child_head, fetched_head,
                          check=False).returncode == 0
    if not direct_ancestor:
        slug = source_branch.replace("/", "%")
        lineage_file = common_dir / "blue-whale" / "implement-spec-lineage" / f"{slug}.json"
        lineage_ref = "refs/agent-implement-spec-lineage/" + slug
        if not lineage_file.is_file():
            raise CleanupError("远端 PR 源分支尚未包含子任务提交，且无已核验的线性化记录，未清理。")
        lineage = load_recovery(lineage_file)
        child_heads = lineage.get("child_heads")
        if not isinstance(child_heads, dict):
            raise CleanupError("线性化记录缺少子任务提交映射，未清理。")
        original_head = str(lineage.get("original_head", ""))
        linearized_head = str(lineage.get("linearized_head", ""))
        original_tree = str(lineage.get("original_tree", ""))
        if (lineage.get("source_branch") != source_branch
                or lineage.get("target_branch") != target_branch
                or lineage.get("pull_request_id") != int(snapshot["pull_request_id"])
                or lineage.get("verified_head") != fetched_head
                or child_heads.get(child_branch) != child_head
                or output(root, "rev-parse", lineage_ref) != original_head
                or git(root, "merge-base", "--is-ancestor", child_head, original_head,
                       check=False).returncode
                or output(root, "rev-parse", f"{original_head}^{{tree}}") != original_tree
                or output(root, "rev-parse", f"{linearized_head}^{{tree}}") != original_tree
                or git(root, "merge-base", "--is-ancestor", linearized_head, fetched_head,
                       check=False).returncode):
            raise CleanupError("线性化记录未证明子任务内容进入已核验的 PR 源分支，未清理。")
    remote_line = output(root, "ls-remote", "--heads", "origin", f"refs/heads/{source_branch}")
    if not remote_line or remote_line.split()[0] != fetched_head:
        raise CleanupError("远端 PR 源分支在核验期间变化，未清理。")
    if output(root, "rev-parse", "HEAD") != child_head or output(root, "status", "--porcelain"):
        raise CleanupError("子任务工作树在核验期间变化，未清理。")
    main_roots = [path for path, _ in entries
                  if Path(output(path, "rev-parse", "--absolute-git-dir")).resolve() == common_dir]
    if len(main_roots) != 1:
        raise CleanupError("找不到唯一的主 checkout，未清理。")
    git(main_roots[0], "worktree", "remove", str(root))
    git(main_roots[0], "update-ref", "-d", f"refs/heads/{child_branch}", child_head)
    return {"status": "CHILD_CLEANED", "child_branch": child_branch,
            "source_branch": source_branch, "source_head": source_head}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr-snapshot", type=Path, required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")
    try:
        root = Path(output(Path.cwd(), "rev-parse", "--show-toplevel")).resolve()
        result = cleanup(root, args.pr_snapshot)
        code = 0
    except (RuntimeError, OSError, ValueError) as exc:
        result = {"status": "CLEANUP_STOPPED", "detail": str(exc)}
        code = 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
