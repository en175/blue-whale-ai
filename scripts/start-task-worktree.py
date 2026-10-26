#!/usr/bin/env python3

import argparse
import hashlib
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from release_line_sync import SyncError, release_line_lock, sync_current_release
from task_metadata import ENVIRONMENT_BRANCHES, TaskMetadataError, read_task_metadata, write_task_metadata


ALLOWED_TYPES = ("feature", "fix", "hotfix", "docs", "chore")
RELEASE_RE = re.compile(
    r"^release/(\d{4})\.(\d{2})\.(\d{2})"
    r"(?:_([A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff]*[\u3400-\u4dbf\u4e00-\u9fff][A-Za-z0-9\u3400-\u4dbf\u4e00-\u9fff]*))?"
    r"(?:_\d+)?$"
)
ISSUE_RE = re.compile(r"^(?=.*[A-Za-z])[A-Za-z0-9]+$")
CHINESE_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")


class WorkflowError(RuntimeError):
    pass


def git(cwd, *args, check=True):
    result = subprocess.run(
        ["git", "-C", str(cwd), *args],
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise WorkflowError("git {} 失败：{}".format(" ".join(args), detail))
    return result


def normalize_summary(summary):
    value = unicodedata.normalize("NFC", summary.strip())
    if not 6 <= len(value) <= 15:
        raise WorkflowError("中文简述必须为 6–15 个字符。")
    if not CHINESE_RE.search(value):
        raise WorkflowError("简述必须包含中文，禁止纯英文或纯拼音标题。")
    if any(character.isspace() for character in value):
        raise WorkflowError("简述不允许包含空格。")
    if any(character in value for character in ("_", "-", "/")):
        raise WorkflowError("简述内部不允许包含下划线、连字符或斜杠。")
    return value


def validate_issue(issue):
    if issue is None:
        return None
    if not ISSUE_RE.fullmatch(issue):
        raise WorkflowError("工单号必须是包含字母的字母数字串，不能是纯数字。")
    return issue


def build_branch(task_type, issue, summary):
    if task_type not in ALLOWED_TYPES:
        raise WorkflowError("分支类型必须是：{}。".format(" ".join(ALLOWED_TYPES)))
    issue = validate_issue(issue)
    summary = normalize_summary(summary)
    suffix = "{}-{}".format(issue, summary) if issue else summary
    branch = "{}/{}".format(task_type, suffix)
    result = subprocess.run(
        ["git", "check-ref-format", "--branch", branch],
        text=True,
        encoding="utf-8",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise WorkflowError("生成的分支名不符合 Git ref 规则：{}".format(branch))
    return branch


def validate_existing_branch(branch):
    if branch in ENVIRONMENT_BRANCHES:
        return branch
    match = RELEASE_RE.fullmatch(branch)
    if match:
        description = match.group(4)
        if description is not None and not 6 <= len(description) <= 15:
            raise WorkflowError("release 分支描述必须为 6–15 个字符：{}".format(branch))
        return branch
    try:
        task_type, suffix = branch.split("/", 1)
    except ValueError as exc:
        raise WorkflowError("分支名必须使用白名单前缀和中文简述。") from exc
    if "-" in suffix:
        issue, summary = suffix.split("-", 1)
    else:
        issue, summary = None, suffix
    expected = build_branch(task_type, issue, summary)
    if expected != branch:
        raise WorkflowError("分支名未使用规范化格式：{}".format(branch))
    return branch


def derive_target(root, task_type, issue, summary):
    if issue:
        directory = "{}-{}".format(task_type, issue.lower())
    else:
        digest = hashlib.sha256(summary.encode("utf-8")).hexdigest()[:8]
        directory = "{}-{}".format(task_type, digest)
    parent = root.parent
    base = parent if parent.name == "blue-whale-worktrees" else parent / "blue-whale-worktrees"
    return base / directory


def integration_commit(root, path):
    if not path.is_absolute():
        raise WorkflowError("--integration-worktree 必须是父工作树绝对路径。")
    parent = path.resolve()
    top = git(parent, "rev-parse", "--show-toplevel").stdout.strip()
    if parent != Path(top).resolve():
        raise WorkflowError("父工作树路径必须指向工作树根目录。")
    common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip()
    parent_common = git(parent, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip()
    if Path(common).resolve() != Path(parent_common).resolve():
        raise WorkflowError("父工作树与当前发布线不属于同一仓库。")
    if git(parent, "status", "--porcelain", "--untracked-files=all").stdout.strip():
        raise WorkflowError("父工作树不干净；请先提交或处理改动。")
    parent_meta = read_task_metadata(parent)
    return parent_meta["target_branch"], git(parent, "rev-parse", "HEAD").stdout.strip()


def create_worktree(args):
    root = Path(__file__).resolve().parents[1]
    issue = args.issue if not args.no_issue else None
    summary = normalize_summary(args.summary)
    branch = build_branch(args.task_type, issue, summary)
    target = derive_target(root, args.task_type, issue, summary)
    if args.integration_worktree and not issue:
        raise WorkflowError("整包子票必须用 --issue 指定已核实父子关系的工单号。")

    if git(root, "show-ref", "--verify", "--quiet", "refs/heads/{}".format(branch), check=False).returncode == 0:
        raise WorkflowError("本地分支已存在：{}".format(branch))
    if target.exists():
        raise WorkflowError("目标 Work Tree 已存在：{}".format(target))

    with release_line_lock(root):
        before_sync = git(root, "rev-parse", "HEAD").stdout.strip()
        parent_target, parent_sha = (integration_commit(root, args.integration_worktree)
                                     if args.integration_worktree else (None, None))
        synced = sync_current_release(root)
        if parent_target and parent_target != synced["branch"]:
            raise WorkflowError("父工作树目标发布线 {} 与当前发布线 {} 不匹配；发布线同步前 {}，同步后 {}。".format(
                parent_target, synced["branch"], before_sync, synced["sha"]))
        target.parent.mkdir(parents=True, exist_ok=True)
        git(root, "worktree", "add", str(target), "-b", branch, synced["sha"])
        try:
            inherited_sha = None
            if parent_sha:
                merge = git(target, "merge", "--no-ff", "--no-edit", "-m",
                            "chore: 继承整包父整合提交", parent_sha, check=False)
                if merge.returncode:
                    raise WorkflowError("整包继承合并失败：{}".format((merge.stderr or merge.stdout).strip()))
                inherited_sha = git(target, "rev-parse", "HEAD").stdout.strip()
            write_task_metadata(target, synced["branch"], synced["sha"], inherited_sha=inherited_sha)
        except (WorkflowError, TaskMetadataError) as exc:
            removed = git(root, "worktree", "remove", "--force", str(target), check=False)
            deleted = git(root, "branch", "-D", branch, check=False) if removed.returncode == 0 else None
            cleanup = ("已清理新建子工作树与分支" if deleted and deleted.returncode == 0
                       else "自动清理失败；worktree: {}；branch: {}".format(
                           removed.stderr.strip(), deleted.stderr.strip() if deleted else "未执行"))
            raise WorkflowError("{}；{}；发布线同步前 {}，同步后 {}。".format(
                exc, cleanup, before_sync, synced["sha"])) from exc

    print("✅ 发布线同步：{}".format(synced["action"]))
    print("✅ 已创建中文任务分支：{}".format(branch))
    print("✅ Work Tree：{}".format(target))
    print("✅ 目标发布线：{}".format(synced["branch"]))
    print("✅ 起点 SHA：{}".format(synced["sha"]))
    if parent_sha:
        print("✅ 父整合提交：{}；继承提交：{}".format(parent_sha, inherited_sha))
    print("下一步：将 Agent 工作目录切换到该 Work Tree；无法切换时在该目录开启新会话。")


def parse_start_args(argv):
    parser = argparse.ArgumentParser(
        description="同步本地活动发布线，再创建结构化中文任务 Work Tree。"
    )
    parser.add_argument("--type", dest="task_type", choices=ALLOWED_TYPES, required=True)
    issue_group = parser.add_mutually_exclusive_group(required=True)
    issue_group.add_argument("--issue", help="Gitee 工单号，例如 IK094T")
    issue_group.add_argument("--no-issue", action="store_true", help="明确声明本任务没有工单")
    parser.add_argument("--summary", required=True, help="6–15 字中文动宾简述")
    parser.add_argument("--integration-worktree", type=Path,
                        help="整包子票的父整合任务工作树绝对路径；先核实 Gitee 父子工单关系")
    return parser.parse_args(argv)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if len(argv) == 2 and argv[0] == "--validate-branch":
            validate_existing_branch(argv[1])
            return 0
        create_worktree(parse_start_args(argv))
        return 0
    except (WorkflowError, SyncError, TaskMetadataError) as exc:
        print("❌ start-task-worktree: {}".format(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
