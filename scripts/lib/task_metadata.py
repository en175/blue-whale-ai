#!/usr/bin/env python3
"""Persist and validate the release baseline of a task worktree."""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


SHA_RE = re.compile(r"^[0-9a-f]{40}$")
TASK_PREFIXES = ("feature/", "fix/", "hotfix/", "docs/", "chore/")


class TaskMetadataError(RuntimeError):
    pass


def git(root, *args, check=True):
    result = subprocess.run(["git", "-C", str(root), *args], text=True, encoding="utf-8",
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and result.returncode:
        raise TaskMetadataError((result.stderr or result.stdout).strip())
    return result


def metadata_path(root):
    git_dir = Path(git(root, "rev-parse", "--absolute-git-dir").stdout.strip())
    return git_dir / "blue-whale" / "task-base.json"


def integration_marker_path(root):
    return metadata_path(root).with_name("task-integration-sha")


def task_branch(root):
    branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", check=False).stdout.strip()
    if not branch.startswith(TASK_PREFIXES):
        raise TaskMetadataError("当前不是任务分支；请切换到任务 worktree。")
    return branch


def validate(root, data, expected_target=None):
    required = {"version", "task_branch", "target_branch", "start_sha"}
    if not isinstance(data, dict) or not required <= set(data) or set(data) - required - {"inherited_sha"}:
        raise TaskMetadataError("任务基线元数据字段无效。")
    if data["version"] != 1 or not isinstance(data["task_branch"], str) or not isinstance(data["target_branch"], str):
        raise TaskMetadataError("任务基线元数据版本或字段类型无效。")
    if not data["target_branch"].startswith("release/") or not isinstance(data["start_sha"], str) or not SHA_RE.fullmatch(data["start_sha"]):
        raise TaskMetadataError("任务基线元数据中的发布线或起点 SHA 无效。")
    if data["task_branch"] != task_branch(root):
        raise TaskMetadataError("任务基线元数据与当前任务分支不符。")
    if expected_target and data["target_branch"] != expected_target:
        raise TaskMetadataError(f"显式目标 {expected_target} 与任务记录的 {data['target_branch']} 冲突；请核对任务起点和目标发布线。")
    if git(root, "cat-file", "-e", data["start_sha"] + "^{commit}", check=False).returncode:
        raise TaskMetadataError("任务记录的起点 SHA 不存在。")
    if git(root, "merge-base", "--is-ancestor", data["start_sha"], "HEAD", check=False).returncode:
        raise TaskMetadataError("任务分支 HEAD 已脱离记录的起点 SHA。")
    inherited_sha = data.get("inherited_sha")
    if "inherited_sha" in data:
        if not isinstance(inherited_sha, str) or not SHA_RE.fullmatch(inherited_sha):
            raise TaskMetadataError("任务继承提交 SHA 无效。")
        if git(root, "cat-file", "-e", inherited_sha + "^{commit}", check=False).returncode:
            raise TaskMetadataError("任务继承提交不存在。")
        if git(root, "merge-base", "--is-ancestor", data["start_sha"], inherited_sha, check=False).returncode:
            raise TaskMetadataError("任务继承提交未包含发布线起点。")
        if git(root, "merge-base", "--is-ancestor", inherited_sha, "HEAD", check=False).returncode:
            raise TaskMetadataError("任务分支 HEAD 已脱离继承提交。")
    marker = integration_marker_path(root)
    if marker.exists():
        try:
            marker_sha = marker.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise TaskMetadataError("任务继承标记无法读取。") from exc
        if data.get("inherited_sha") != marker_sha:
            raise TaskMetadataError("任务继承标记与基线元数据不一致。")
    return data


def read_task_metadata(root, expected_target=None):
    path = metadata_path(root)
    if not path.is_file():
        raise TaskMetadataError("缺少任务基线元数据；请从活动发布线重新建立任务区，旧任务区须显式执行 task_metadata.py repair。")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TaskMetadataError("任务基线元数据无法读取；请检查文件或显式修复，不能回退 master。") from exc
    return validate(root, data, expected_target)


def write_task_metadata(root, target_branch, start_sha, *, inherited_sha=None, repair=False):
    root = Path(root).resolve()
    path = metadata_path(root)
    if path.exists():
        raise TaskMetadataError("任务基线元数据已存在；拒绝覆盖原起点。")
    marker = integration_marker_path(root)
    if marker.exists():
        if not repair:
            raise TaskMetadataError("任务继承标记已存在；拒绝覆盖。")
        try:
            inherited_sha = marker.read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise TaskMetadataError("任务继承标记无法读取。") from exc
    data = {"version": 1, "task_branch": task_branch(root),
            "target_branch": target_branch, "start_sha": start_sha}
    if inherited_sha is not None:
        data["inherited_sha"] = inherited_sha
    validate(root, data)
    if repair:
        local = git(root, "rev-parse", "--verify", "--quiet", f"refs/heads/{target_branch}", check=False)
        if local.returncode or git(root, "merge-base", "--is-ancestor", start_sha, local.stdout.strip(), check=False).returncode:
            raise TaskMetadataError("本地目标发布线不存在或未包含指定起点 SHA；请核对目标和起点。")
    path.parent.mkdir(parents=True, exist_ok=True)
    if inherited_sha is not None and not repair:
        marker_fd, marker_temporary = tempfile.mkstemp(prefix="task-integration-", dir=path.parent)
        try:
            with os.fdopen(marker_fd, "w", encoding="utf-8") as stream:
                stream.write(inherited_sha + "\n")
            os.replace(marker_temporary, marker)
        finally:
            if os.path.exists(marker_temporary):
                os.unlink(marker_temporary)
    fd, temporary = tempfile.mkstemp(prefix="task-base-", suffix=".json", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description="读取或显式修复任务发布线基线元数据")
    commands = parser.add_subparsers(dest="command", required=True)
    read = commands.add_parser("read")
    read.add_argument("--json", action="store_true")
    read.add_argument("--field", choices=("task_branch", "target_branch", "start_sha", "inherited_sha"))
    read.add_argument("--target-branch")
    read.add_argument("--worktree", type=Path, default=Path.cwd())
    repair = commands.add_parser("repair")
    repair.add_argument("--target-branch", required=True)
    repair.add_argument("--start-sha", required=True)
    repair.add_argument("--user-authorized", action="store_true")
    repair.add_argument("--worktree", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    try:
        if args.command == "read":
            data = read_task_metadata(args.worktree, args.target_branch)
        else:
            if not args.user_authorized:
                raise TaskMetadataError("旧任务区修复需当前会话用户授权并显式传 --user-authorized。")
            data = write_task_metadata(args.worktree, args.target_branch, args.start_sha, repair=True)
        print(data.get(args.field, "") if args.command == "read" and args.field else
              json.dumps(data, ensure_ascii=False) if args.command == "read" and args.json else
              json.dumps(data, ensure_ascii=False, indent=2))
        return 0
    except TaskMetadataError as exc:
        print(f"❌ task-metadata: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
