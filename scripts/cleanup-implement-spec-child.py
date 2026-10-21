#!/usr/bin/env python3
"""Remove a child worktree after its commit is present in the verified remote PR source."""

from __future__ import annotations

import argparse
import json
import os
import re
import runpy
import subprocess
import sys
import tempfile
from pathlib import Path

from lib.task_metadata import read_task_metadata
from sync_recovery import load_record


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


def rebase_lineage_proves(root: Path, common_dir: Path, source_branch: str,
                          target_branch: str, pull_request_id: int,
                          child_branch: str, child_head: str, source_head: str,
                          initial_verified: str | None = None) -> bool:
    slug = source_branch.replace("/", "%")
    directory = common_dir / "blue-whale" / "implement-spec-rebase-lineage" / slug
    if not directory.is_dir():
        return False
    records = []
    for path in directory.glob("*.json"):
        record = load_record(path)
        if (record.get("proof_kind") == "rebase"
                and record.get("source_branch") == source_branch
                and record.get("target_branch") == target_branch
                and record.get("pull_request_id") == pull_request_id):
            records.append((path, record))
    reachable = {initial_verified} if initial_verified else set()
    proven = set()
    for _ in records:
        for path, record in records:
            original = str(record.get("original_head", ""))
            synced = str(record.get("synced_head", ""))
            verified = str(record.get("verified_head", ""))
            children = record.get("child_heads")
            if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (original, synced, verified)):
                raise CleanupError("同步证明含无效提交 SHA，未清理。")
            if not isinstance(children, dict):
                raise CleanupError("同步证明缺少子任务映射，未清理。")
            direct = (child_head == original
                      or (children.get(child_branch) == child_head
                          and git(root, "merge-base", "--is-ancestor", child_head,
                                  original, check=False).returncode == 0))
            chained = any(git(root, "merge-base", "--is-ancestor", previous,
                              original, check=False).returncode == 0 for previous in reachable)
            if not direct and not chained:
                continue
            ref = f"refs/agent-implement-spec-rebase-lineage/{slug}/{synced}"
            retained = git(root, "rev-parse", "--verify", ref, check=False)
            expected = git(root, "merge-tree", "--write-tree", "--name-only",
                           str(record.get("upstream_sha", "")), original, check=False)
            lines = expected.stdout.splitlines()
            auto_tree = lines[0] if lines else ""
            end = lines.index("") if "" in lines else len(lines)
            conflicts = lines[1:end]
            resolved = record.get("resolved_files")
            if resolved is None:
                tree_valid = expected.returncode == 0 and auto_tree == record.get("merged_tree")
            else:
                changed = output(root, "diff", "--name-only", auto_tree,
                                 str(record.get("merged_tree", ""))).splitlines()
                scopes = [re.sub(r"~(?:HEAD|[0-9a-f]{40})$", "", name)
                          for name in conflicts]
                tree_valid = (isinstance(resolved, list) and expected.returncode != 0
                              and record.get("auto_tree") == auto_tree
                              and record.get("conflict_files") == conflicts
                              and resolved == changed
                              and all(any(path == scope or path.startswith(scope + "/")
                                          for scope in scopes) for path in changed))
            if (path.stem != synced or retained.returncode or retained.stdout.strip() != original
                    or not tree_valid
                    or output(root, "rev-parse", f"{synced}^{{tree}}") != record.get("merged_tree")
                    or git(root, "merge-base", "--is-ancestor", synced,
                           verified, check=False).returncode):
                raise CleanupError("同步证明未通过原提交、合并文件树和远端回读核对，未清理。")
            reachable.add(verified)
            proven.add(verified)
    return any(git(root, "merge-base", "--is-ancestor", verified,
                   source_head, check=False).returncode == 0 for verified in proven)


def equivalent_commit_proves(root: Path, child: dict, child_head: str,
                            source_head: str, equivalent: str) -> bool:
    if not re.fullmatch(r"[0-9a-f]{40}", equivalent):
        raise CleanupError("等价提交必须是完整 SHA，未清理。")
    parents = output(root, "rev-list", "--parents", "-n", "1", child_head).split()
    if len(parents) != 2 or child.get("inherited_sha") != parents[1]:
        raise CleanupError("等价核验仅支持继承提交后的单个子任务提交，未清理。")
    if git(root, "merge-base", "--is-ancestor", equivalent, source_head, check=False).returncode:
        raise CleanupError("等价提交未进入该 PR 源 HEAD，未清理。")
    target_parents = output(root, "rev-list", "--parents", "-n", "1", equivalent).split()
    if len(target_parents) != 2:
        raise CleanupError("等价提交必须是单父提交，未清理。")
    patches = []
    for parent, head in ((parents[1], child_head), (target_parents[1], equivalent)):
        result = subprocess.run(["git", "-C", str(root), "diff", "--no-ext-diff",
                                 "--no-textconv", "--no-renames", "--binary", "--full-index",
                                 "--unified=0", parent, head], capture_output=True, check=True)
        patches.append(result.stdout)
    normalized = [b"\n".join(line for line in patch.split(b"\n")
                              if not line.startswith(b"index ")) for patch in patches]
    if not patches[0] or normalized[0] != normalized[1]:
        raise CleanupError("等价提交的路径、位置或增删内容不同，未清理。")
    with tempfile.TemporaryDirectory(prefix="child-cleanup-proof-") as directory:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(directory) / "index")}
        subprocess.run(["git", "-C", str(root), "read-tree", target_parents[1]],
                       env=env, capture_output=True, check=True)
        applied = subprocess.run(["git", "-C", str(root), "apply", "--cached", "--unidiff-zero"],
                                 env=env, input=patches[0], capture_output=True)
        if applied.returncode:
            raise CleanupError("子任务补丁无法在等价提交父树精确重放，未清理。")
        tree = subprocess.run(["git", "-C", str(root), "write-tree"], env=env,
                              capture_output=True, text=True, check=True).stdout.strip()
    if tree != output(root, "rev-parse", f"{equivalent}^{{tree}}"):
        raise CleanupError("等价提交的完整文件树不一致，未清理。")
    return True


def cleanup(root: Path, snapshot_path: Path, equivalent: str | None = None) -> dict[str, str]:
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
    if snapshot["state"] not in {"opened", "merged"} or not re.fullmatch(r"[0-9a-f]{40}", source_head):
        raise CleanupError("PR 快照必须是已开放或已合并且带有效源 HEAD 的记录。")
    if source_branch == child_branch or target_branch != child["target_branch"]:
        raise CleanupError("PR 源分支或目标发布线与子任务记录不符。")
    entries = worktrees(root)
    merged = snapshot["state"] == "merged"
    if not merged:
        integration_roots = [path for path, branch in entries if branch == source_branch]
        if len(integration_roots) != 1:
            raise CleanupError("找不到唯一的 PR 集成任务 worktree。")
        integration = read_task_metadata(integration_roots[0], target_branch)
        if integration["task_branch"] != source_branch:
            raise CleanupError("PR 集成任务元数据不符。")

    remote_branch = target_branch if merged else source_branch
    fetched = git(root, "fetch", "--no-tags", "origin", f"refs/heads/{remote_branch}", check=False)
    if fetched.returncode:
        raise CleanupError("无法读取远端 PR 核验分支，未清理：" + fetched.stderr.strip())
    fetched_head = output(root, "rev-parse", "FETCH_HEAD^{commit}")
    if merged and git(root, "merge-base", "--is-ancestor", source_head,
                      fetched_head, check=False).returncode:
        raise CleanupError("远端目标发布线尚未包含已合并 PR 的源 HEAD，未清理。")
    if not merged and fetched_head != source_head:
        raise CleanupError("PR 快照与远端源分支 HEAD 不一致，未清理。")
    direct_ancestor = git(root, "merge-base", "--is-ancestor", child_head, source_head,
                          check=False).returncode == 0
    if equivalent is not None:
        if not merged:
            raise CleanupError("等价提交清理仅支持已合并 PR，未清理。")
        direct_ancestor = equivalent_commit_proves(root, child, child_head, source_head, equivalent)
    if not direct_ancestor:
        if rebase_lineage_proves(root, common_dir, source_branch, target_branch,
                                 int(snapshot["pull_request_id"]), child_branch,
                                 child_head, source_head):
            direct_ancestor = True
    if not direct_ancestor:
        slug = source_branch.replace("/", "%")
        lineage_file = common_dir / "blue-whale" / "implement-spec-lineage" / f"{slug}.json"
        lineage_ref = "refs/agent-implement-spec-lineage/" + slug
        if not lineage_file.is_file():
            raise CleanupError("远端 PR 源分支尚未包含子任务提交，且无已核验的线性化记录，未清理。"
                               + ("已合并 PR 的移植提交请显式传 --equivalent-commit <完整 SHA>。"
                                  if merged else ""))
        lineage = load_record(lineage_file)
        child_heads = lineage.get("child_heads")
        if not isinstance(child_heads, dict):
            raise CleanupError("线性化记录缺少子任务提交映射，未清理。")
        original_head = str(lineage.get("original_head", ""))
        linearized_head = str(lineage.get("linearized_head", ""))
        original_tree = str(lineage.get("original_tree", ""))
        if (lineage.get("source_branch") != source_branch
                or lineage.get("target_branch") != target_branch
                or lineage.get("pull_request_id") != int(snapshot["pull_request_id"])
                or child_heads.get(child_branch) != child_head
                or output(root, "rev-parse", lineage_ref) != original_head
                or git(root, "merge-base", "--is-ancestor", child_head, original_head,
                       check=False).returncode
                or output(root, "rev-parse", f"{original_head}^{{tree}}") != original_tree
                or output(root, "rev-parse", f"{linearized_head}^{{tree}}") != original_tree
                or git(root, "merge-base", "--is-ancestor", linearized_head,
                       str(lineage.get("verified_head", "")),
                       check=False).returncode):
            raise CleanupError("线性化记录未证明子任务内容进入已核验的 PR 源分支，未清理。")
        verified_head = str(lineage["verified_head"])
        if verified_head != source_head and not rebase_lineage_proves(
                root, common_dir, source_branch, target_branch,
                int(snapshot["pull_request_id"]), child_branch, child_head,
                source_head, initial_verified=verified_head):
            raise CleanupError("线性化后的同步证明未接续到当前 PR 源提交，未清理。")
    remote_line = output(root, "ls-remote", "--heads", "origin", f"refs/heads/{remote_branch}")
    if not remote_line or remote_line.split()[0] != fetched_head:
        raise CleanupError("远端 PR 核验分支在核验期间变化，未清理。")
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
    parser.add_argument("--equivalent-commit", help="已合并 PR 中与单个子任务补丁精确等价的完整提交 SHA")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")
    try:
        root = Path(output(Path.cwd(), "rev-parse", "--show-toplevel")).resolve()
        result = cleanup(root, args.pr_snapshot, args.equivalent_commit)
        code = 0
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as exc:
        result = {"status": "CLEANUP_STOPPED", "detail": str(exc)}
        code = 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
