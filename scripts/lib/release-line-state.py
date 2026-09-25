#!/usr/bin/env python3
"""Manage one team-wide active release line through a remote Git branch."""

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

from release_line_sync import SyncError, release_line_lock
from task_metadata import TASK_PREFIXES, TaskMetadataError, read_task_metadata

ROOT = Path(__file__).resolve().parents[2]
STATE_REF = "refs/heads/chore/发布线状态记录"
STATE_FILE = "release-line.json"


class ReleaseError(Exception):
    pass


def git(*args, input_text=None, check=True):
    result = subprocess.run(
        ["git", "-C", str(ROOT), *args], input=input_text, text=True,
        encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode:
        raise ReleaseError(result.stderr.strip() or f"git {' '.join(args)} 失败")
    return result


def refresh():
    result = git("fetch", "origin", "--prune", check=False)
    if result.returncode:
        raise ReleaseError("远端不可达，发布线状态未核实：" + result.stderr.strip())


def releases():
    output = git("for-each-ref", "--format=%(refname:lstrip=3)",
                 "refs/remotes/origin/release/*").stdout
    return sorted(filter(None, output.splitlines()))


def release_date(branch):
    match = re.fullmatch(r"release/(\d{4})\.(\d{1,2})\.(\d{1,2})(?:_.+)?", branch)
    if not match:
        return None
    try:
        return dt.date(*(int(part) for part in match.groups()))
    except ValueError:
        return None


def recent_releases(count):
    output = git("for-each-ref", f"--count={count}", "--sort=-creatordate",
                 "--format=%(refname:lstrip=3)",
                 "refs/remotes/origin/release/*").stdout
    return list(filter(None, output.splitlines()))


def read_state():
    rows = git("ls-remote", "--heads", "origin", STATE_REF).stdout.splitlines()
    if not rows:
        return None, None
    if len(rows) != 1:
        raise ReleaseError("远端共享状态引用不唯一。")
    sha = rows[0].split()[0]
    result = git("fetch", "origin", STATE_REF, check=False)
    if result.returncode:
        raise ReleaseError("无法读取远端共享状态：" + result.stderr.strip())
    raw = git("show", f"{sha}:{STATE_FILE}", check=False)
    if raw.returncode:
        raise ReleaseError("远端共享状态文件不存在。")
    try:
        state = json.loads(raw.stdout)
    except json.JSONDecodeError as exc:
        raise ReleaseError("远端共享状态 JSON 损坏。") from exc
    if (not isinstance(state, dict) or state.get("version") != 1
            or not isinstance(state.get("active"), str)
            or not isinstance(state.get("legacy"), list)
            or any(not isinstance(x, str) for x in state["legacy"])
            or state["active"] in state["legacy"]
            or len(state["legacy"]) != len(set(state["legacy"]))):
        raise ReleaseError("远端共享状态字段不一致。")
    return sha, state


def classify_releases(state, branches):
    if state is None:
        dated = [(branch, release_date(branch)) for branch in branches]
        newest = max((day for _, day in dated if day is not None), default=None)
        latest_count = sum(day == newest for _, day in dated) if newest else 0
        unclassified = [branch for branch, day in dated
                        if day is None or (day == newest and latest_count > 1)]
        return branches, [], unclassified
    active = state["active"]
    if not active.startswith("release/") or active not in branches:
        raise ReleaseError(f"已启用的 {active} 在远端不存在，状态不一致。")
    if any(not x.startswith("release/") for x in state["legacy"]):
        raise ReleaseError("共享状态包含非法历史分支。")
    active_date = release_date(active)
    if active_date is None:
        raise ReleaseError(f"已启用的 {active} 无法按日期识别，请负责人核对共享状态。")
    pending, historical, unclassified = [], list(state["legacy"]), []
    for branch in branches:
        if branch == active or branch in historical:
            continue
        day = release_date(branch)
        if day is None or day == active_date:
            unclassified.append(branch)
        elif day < active_date:
            historical.append(branch)
        else:
            pending.append(branch)
    return pending, historical, unclassified


def require_classified(unclassified):
    if unclassified:
        raise ReleaseError("新出现的发布线无法按日期归类，请负责人确认或撤回："
                           + ", ".join(unclassified))


def worktrees():
    output = git("worktree", "list", "--porcelain").stdout
    rows, path, branch = [], None, None
    for line in output.splitlines() + [""]:
        if not line:
            if path and branch and branch != "refs/heads/master":
                item = {"path": path, "branch": branch.removeprefix("refs/heads/")}
                if item["branch"].startswith(TASK_PREFIXES):
                    try:
                        item["target_branch"] = read_task_metadata(Path(path))["target_branch"]
                    except TaskMetadataError as exc:
                        item["metadata_error"] = str(exc)
                rows.append(item)
            path = branch = None
        elif line.startswith("worktree "):
            path = line[9:]
        elif line.startswith("branch "):
            branch = line[7:]
    return rows


def unmerged_task_branches(inventory_rows):
    checked_out = {item["branch"] for item in inventory_rows}
    branches = git("for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads").stdout.splitlines()
    pending = []
    for branch in branches:
        if not branch.startswith(TASK_PREFIXES) or branch in checked_out:
            continue
        contained = git("for-each-ref", f"--contains=refs/heads/{branch}",
                        "--format=%(refname)", "refs/remotes/origin/master",
                        "refs/remotes/origin/release").stdout.strip()
        if not contained:
            pending.append(branch)
    return pending


def emit(data, as_json, message):
    print(json.dumps(data, ensure_ascii=False, separators=(",", ":")) if as_json else message)


def current(args):
    refresh()
    branches = releases()
    sha, state = read_state()
    if state is None:
        raise ReleaseError("团队尚未启用当前发布线；请由负责人清点并执行 activate。")
    pending, historical, unclassified = classify_releases(state, branches)
    require_classified(unclassified)
    if pending:
        raise ReleaseError("发现未经授权的候选，停止自动选择：" + ", ".join(pending))
    emit({"branch": state["active"], "state_sha": sha, "candidates": pending,
          "legacy": historical}, args.json, f"当前发布线：{state['active']}（状态 {sha}）")


def listing(args):
    refresh()
    branches = releases()
    sha, state = read_state()
    pending, historical, unclassified = classify_releases(state, branches)
    inventory_rows = worktrees()
    data = {"branch": state["active"] if state else None, "state_sha": sha,
            "candidates": pending, "legacy": historical,
            "unclassified": unclassified,
            "recent": recent_releases(args.count),
            "task_worktrees": inventory_rows,
            "unmerged_task_branches": unmerged_task_branches(inventory_rows)}
    if args.pr_snapshot and data["branch"]:
        data["open_prs"] = pr_snapshot(args.pr_snapshot, data["branch"])
    if args.json:
        emit(data, True, "")
        return
    if not branches:
        print("远端没有 release/* 分支。")
    print("当前发布线：" + (data["branch"] or "未启用"))
    print(f"最近 {args.count} 条 release 分支：")
    for branch in data["recent"]:
        print(f"  {branch}")
    print("待授权候选：" + (", ".join(pending) or "无"))
    print("历史分支：" + (", ".join(historical) or "无"))
    print("待归类分支：" + (", ".join(unclassified) or "无"))
    print("任务 worktree：")
    for item in data["task_worktrees"]:
        target = item.get("target_branch", item.get("metadata_error", "非任务分支"))
        print(f"  {item['branch']}  {item['path']}  {target}")
    print("未检出且未合入的任务分支：" + (", ".join(data["unmerged_task_branches"]) or "无"))
    if args.pr_snapshot and data["branch"]:
        print("以当前发布线为目标的开放 PR：")
        for pull in data["open_prs"]:
            print(f"  !{pull.get('number', pull.get('id', '?'))}  {pull.get('title', '')}")
    else:
        print("开放 PR 请由 Agent 通过 Gitee MCP 清点，并用 --pr-snapshot 传入近期查询快照。")


def assert_main():
    git_dir = Path(git("rev-parse", "--absolute-git-dir").stdout.strip()).resolve()
    common = Path(git("rev-parse", "--path-format=absolute",
                      "--git-common-dir").stdout.strip()).resolve()
    if git_dir != common:
        raise ReleaseError("仅可在主 checkout 创建或启用发布线。")
    branch = git("symbolic-ref", "--short", "HEAD", check=False).stdout.strip()
    if branch != "master":
        raise ReleaseError(f"创建或启用发布线需在主 checkout 的 master 执行，当前为 {branch or 'detached HEAD'}。")


def validate(branch):
    if not branch.startswith("release/"):
        raise ReleaseError("目标必须为 release/* 分支。")
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/start-task-worktree.py"),
         "--validate-branch", branch], cwd=ROOT, text=True, encoding="utf-8",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if result.returncode:
        raise ReleaseError("release 分支名校验失败：" + result.stderr.strip())


def pr_snapshot(path, targets):
    if not path:
        raise ReleaseError("换期需 --pr-snapshot <JSON>；先通过 Gitee MCP 查询开放 PR。")
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        at = dt.datetime.fromisoformat(data["fetched_at"].replace("Z", "+00:00"))
        pulls = data["pulls"]
    except (OSError, KeyError, ValueError, TypeError) as exc:
        raise ReleaseError("PR 快照缺少 fetched_at 或 pulls，或文件不可读。") from exc
    if at.tzinfo is None or abs((dt.datetime.now(dt.timezone.utc) - at).total_seconds()) > 900:
        raise ReleaseError("PR 快照超过 15 分钟或时间无时区，请重新查询 Gitee。")
    if data.get("project_id") != 48854568 or data.get("state") != "open" or data.get("complete") is not True:
        raise ReleaseError("PR 快照须来自本仓全部开放 PR 分页，包含 project_id=48854568、state=open、complete=true。")
    if not isinstance(pulls, list) or any(
        not isinstance(p, dict) or not isinstance(p.get("target_branch"), str)
        or not isinstance(p.get("state"), str) for p in pulls
    ):
        raise ReleaseError("PR 快照 pulls 每项需包含 target_branch 和 state。")
    targets = {targets} if isinstance(targets, str) else set(targets)
    return [p for p in pulls if p["target_branch"] in targets
            and p["state"].lower() in ("open", "opened", "progressing")]


def assert_closed(old, snapshot, require_merged=True, allow_pending=False,
                  allow_release_changes=False):
    old_branches = [old] if isinstance(old, str) else old
    if require_merged and git("rev-parse", "--verify", "origin/master", check=False).returncode:
        raise ReleaseError("origin/master 不可用，无法核实旧批次。")
    inventory_rows = worktrees()
    old_tasks = []
    for item in inventory_rows:
        target = item.get("target_branch")
        if target not in old_branches:
            continue
        head = git("-C", item["path"], "rev-parse", "HEAD").stdout.strip()
        changes = git("-C", item["path"], "status", "--porcelain",
                      "--untracked-files=all").stdout.strip()
        if changes or git("merge-base", "--is-ancestor", head, f"origin/{target}",
                          check=False).returncode:
            old_tasks.append(item)
    unassigned = [item for item in inventory_rows if "metadata_error" in item]
    unmerged_branches = unmerged_task_branches(inventory_rows)
    tasks = ", ".join(item["branch"] for item in old_tasks) or "无"
    unknown = ", ".join(item["branch"] for item in unassigned) or "无"
    local_commits = []
    dirty = []
    release_inventory = []
    for branch in old_branches:
        local_ref = f"refs/heads/{branch}"
        remote_ref = f"refs/remotes/origin/{branch}"
        remote_exists = not git("show-ref", "--verify", "--quiet", remote_ref,
                                check=False).returncode
        entry = {"branch": branch, "remote_exists": remote_exists}
        if not git("show-ref", "--verify", "--quiet", local_ref, check=False).returncode:
            entry["local_head"] = git("rev-parse", local_ref).stdout.strip()
            if remote_exists:
                ahead = git("log", "--format=%h %s", f"{remote_ref}..{local_ref}").stdout.strip()
            else:
                ahead = git("log", "--format=%h %s", local_ref,
                            "--not", "--remotes=origin").stdout.strip()
            entry["local_commit_count"] = int(git(
                "rev-list", "--count", local_ref, "--not", "--remotes=origin"
            ).stdout.strip())
            if ahead:
                local_commits.append(f"{branch}: {ahead}")
        entry["worktree_changes"] = []
        for item in inventory_rows:
            if item["branch"] == branch:
                changes = git("-C", item["path"], "status", "--porcelain",
                              "--untracked-files=all").stdout.strip()
                if changes:
                    entry["worktree_changes"].append({"path": item["path"], "status": changes})
                    dirty.append(f"{branch}: {changes}")
        release_inventory.append(entry)
    if snapshot:
        open_pulls = pr_snapshot(snapshot, old_branches)
        pulls = ", ".join(f"!{p.get('number', p.get('id', '?'))} ({p['target_branch']})"
                           for p in open_pulls) or "无"
    else:
        open_pulls = []
        pulls = "未核对（需 --pr-snapshot）"
    inventory = (f"待处理任务：{tasks}；归属未核实任务：{unknown}；"
                 f"未检出且未合入的任务分支：{', '.join(unmerged_branches) or '无'}；"
                 f"本地领先提交：{'; '.join(local_commits) or '无'}；"
                 f"未保存文件：{'; '.join(dirty) or '无'}；开放 PR：{pulls}")
    if require_merged:
        for branch in old_branches:
            if git("merge-base", "--is-ancestor", f"origin/{branch}", "origin/master",
                   check=False).returncode:
                raise ReleaseError(f"旧活动发布线 {branch} 尚未进入 origin/master，拒绝换期；{inventory}。")
    if not snapshot:
        raise ReleaseError(f"换期需 --pr-snapshot <JSON>；{inventory}。")
    if ((not allow_release_changes and (local_commits or dirty)) or
            (not allow_pending and
             (old_tasks or unassigned or unmerged_branches or open_pulls))):
        raise ReleaseError(f"旧发布线仍有待处理事项，拒绝换期；{inventory}；请负责人决定去向。")
    return {"release_branches": release_inventory,
            "task_worktrees": old_tasks, "unassigned_task_worktrees": unassigned,
            "unmerged_task_branches": unmerged_branches, "open_prs": open_pulls}


def write_state(previous, active, legacy):
    payload = json.dumps({"version": 1, "active": active, "legacy": legacy},
                         ensure_ascii=False, sort_keys=True) + "\n"
    blob = git("hash-object", "-w", "--stdin", input_text=payload).stdout.strip()
    tree = git("mktree", input_text=f"100644 blob {blob}\t{STATE_FILE}\n").stdout.strip()
    args = ["commit-tree", tree]
    if previous:
        args += ["-p", previous]
    commit = git(*args, input_text=f"chore: 启用发布线 {active}\n").stdout.strip()
    result = git("push", "origin", f"{commit}:{STATE_REF}", check=False)
    if result.returncode:
        raise ReleaseError("共享状态推送失败，可能另一位负责人已换期；请重新读取。" + result.stderr.strip())
    return commit


def activate(args):
    if not args.user_authorized:
        raise ReleaseError("启用发布线需负责人授权并传 --user-authorized。")
    if args.bootstrap_existing:
        git_dir = Path(git("rev-parse", "--absolute-git-dir").stdout.strip()).resolve()
        common = Path(git("rev-parse", "--path-format=absolute",
                          "--git-common-dir").stdout.strip()).resolve()
        branch = git("symbolic-ref", "--quiet", "--short", "HEAD", check=False).stdout.strip()
        if git_dir == common or not branch.startswith(TASK_PREFIXES):
            raise ReleaseError("首次接管仅可从隔离任务工作树执行。")
        if git("merge-base", "--is-ancestor", f"refs/heads/{args.branch}", "HEAD",
               check=False).returncode:
            raise ReleaseError("首次接管工作树未基于目标本地发布线。")
        if git("status", "--porcelain", "--untracked-files=all").stdout.strip():
            raise ReleaseError("首次接管工作树有未提交文件，请先收口。")
    else:
        assert_main()
    with release_line_lock(ROOT):
        activate_locked(args)


def activate_locked(args):
    validate(args.branch)
    refresh()
    branches = releases()
    previous, state = read_state()
    if args.branch not in branches:
        raise ReleaseError(f"目标发布线 {args.branch} 在远端不存在。")
    if args.bootstrap_existing and state is not None:
        raise ReleaseError("--bootstrap-existing 仅适用于首次启用。")
    if state is not None and args.classify_legacy:
        raise ReleaseError("--classify-legacy 仅适用于首次启用。")
    legacy_inventory = None
    if state is None:
        local_releases = set(git("for-each-ref", "--format=%(refname:lstrip=2)",
                                 "refs/heads/release/*").stdout.splitlines())
        local_only = sorted(local_releases - set(branches))
        if local_only and not args.bootstrap_existing:
            dirty = []
            for item in worktrees():
                if item["branch"] in local_only:
                    changes = git("-C", item["path"], "status", "--porcelain",
                                  "--untracked-files=all").stdout.strip()
                    if changes:
                        dirty.append(f"{item['branch']}: {changes}")
            raise ReleaseError("本地旧发布线无同名远端，拒绝首次启用：" + ", ".join(local_only)
                               + "；未保存文件：" + ("; ".join(dirty) or "无")
                               + "；请负责人决定去向。")
        all_releases = set(branches) | local_releases
        target_date = release_date(args.branch)
        if target_date is None or any(
                day is not None and day > target_date
                for day in (release_date(name) for name in all_releases)):
            raise ReleaseError("首次启用目标须为日期最新的 release 分支。")
        others = sorted(x for x in all_releases if x != args.branch)
        if others and not args.adopt_legacy:
            raise ReleaseError("首次启用发现多条分支，请清点后显式传 --adopt-legacy：" + ", ".join(others))
        unclassified = [name for name in others if release_date(name) in (None, target_date)]
        if sorted(args.classify_legacy) != unclassified:
            raise ReleaseError("首次启用有待归类分支：" + (", ".join(unclassified) or "无")
                               + "；确认其为历史后逐个传 --classify-legacy <分支名>，或撤回分支。")
        if others:
            legacy_inventory = assert_closed(others, args.pr_snapshot,
                                             require_merged=False,
                                             allow_pending=args.bootstrap_existing,
                                             allow_release_changes=args.bootstrap_existing)
        legacy = others
    else:
        pending, historical, unclassified = classify_releases(state, branches)
        if args.branch == state["active"]:
            if args.adopt_legacy and unclassified:
                legacy = historical + unclassified
                sha = write_state(previous, args.branch, legacy)
                emit({"branch": args.branch, "state_sha": sha,
                      "candidates": pending, "legacy": legacy,
                      "unclassified": []}, args.json,
                     "已将待归类分支登记为历史：" + ", ".join(unclassified))
                return
            require_classified(unclassified)
            if pending:
                raise ReleaseError("还有待授权候选：" + ", ".join(pending))
            emit({"branch": args.branch, "state_sha": previous, "candidates": [],
                  "legacy": historical}, args.json, f"当前已启用：{args.branch}")
            return
        if args.branch in unclassified and args.adopt_legacy:
            if pending:
                raise ReleaseError("还有日期更新的待授权候选：" + ", ".join(pending))
            assert_closed(state["active"], args.pr_snapshot)
            legacy = historical + [state["active"]] + [
                branch for branch in unclassified if branch != args.branch]
        else:
            require_classified(unclassified)
            if len(pending) != 1 or pending[0] != args.branch:
                raise ReleaseError("候选不唯一或目标并非唯一候选：" + ", ".join(pending))
            assert_closed(state["active"], args.pr_snapshot)
            legacy = historical + [state["active"]]
    sha = write_state(previous, args.branch, legacy)
    result = {"branch": args.branch, "state_sha": sha, "candidates": [],
              "legacy": legacy, "task_worktrees": worktrees()}
    if legacy_inventory is not None:
        result["legacy_inventory"] = legacy_inventory
    emit(result, args.json, f"已启用发布线：{args.branch}（状态 {sha}）")


def create(args):
    if not args.user_authorized:
        raise ReleaseError("创建 release 分支需负责人授权并传 --user-authorized。")
    assert_main()
    with release_line_lock(ROOT):
        create_locked(args)


def create_locked(args):
    if args.summary and (any(x in args.summary for x in "_-/\\")
                         or any(x.isspace() for x in args.summary)):
        raise ReleaseError("描述禁止包含空格、下划线、连字符、斜杠或反斜杠。")
    refresh()
    branches = releases()
    previous, state = read_state()
    if state:
        pending, historical, unclassified = classify_releases(state, branches)
        require_classified(unclassified)
        if pending:
            raise ReleaseError("已有待授权候选，不能继续创建：" + ", ".join(pending))
        assert_closed(state["active"], args.pr_snapshot)
        legacy = historical + [state["active"]]
    elif branches:
        raise ReleaseError("已有远端 release 分支但尚未启用当前线，请先清点并 activate：" + ", ".join(branches))
    else:
        legacy = []
    branch = "release/" + dt.datetime.now().strftime("%Y.%m.%d")
    if state and release_date(branch) <= release_date(state["active"]):
        raise ReleaseError("新批次日期须晚于当前发布线；请核对日期后再创建。")
    if args.summary:
        branch += "_" + args.summary
    base_name = branch
    suffix = 1
    while branch in branches or not git("show-ref", "--verify", "--quiet",
                                       f"refs/heads/{branch}", check=False).returncode:
        suffix += 1
        branch = f"{base_name}_{suffix}"
    validate(branch)
    master = git("rev-parse", "origin/master").stdout.strip()
    git("branch", branch, master)
    pushed = git("push", "-u", "origin", branch, check=False)
    if pushed.returncode:
        git("update-ref", "-d", f"refs/heads/{branch}", check=False)
        raise ReleaseError("推送失败，已回滚本地新分支：" + pushed.stderr.strip())
    try:
        sha = write_state(previous, branch, legacy)
    except (ReleaseError, SyncError) as exc:
        raise ReleaseError(f"已推送 {branch}，但共享状态未启用；保留分支供核查。{exc}") from exc
    emit({"status": "created", "branch": branch, "base": master,
          "state_sha": sha, "legacy": legacy},
         args.json, f"已创建并启用 release 分支：{branch}")


def main():
    parser = argparse.ArgumentParser(description="管理团队唯一当前发布线")
    parser.add_argument("action", choices=("list", "current", "activate", "create"))
    parser.add_argument("--branch")
    parser.add_argument("--summary", default="")
    parser.add_argument("--count", type=int, default=3)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--user-authorized", action="store_true")
    parser.add_argument("--pr-snapshot")
    parser.add_argument("--adopt-legacy", action="store_true")
    parser.add_argument("--classify-legacy", action="append", default=[])
    parser.add_argument("--bootstrap-existing", action="store_true")
    args = parser.parse_args()
    if args.classify_legacy and args.action != "activate":
        raise ReleaseError("--classify-legacy 仅适用于 activate。")
    if args.count < 1:
        raise ReleaseError("--count 必须为正整数。")
    if args.action == "list":
        listing(args)
    elif args.action == "current":
        current(args)
    elif args.action == "activate":
        if not args.branch:
            raise ReleaseError("activate 需要 --branch release/<名称>。")
        activate(args)
    else:
        create(args)


if __name__ == "__main__":
    try:
        main()
    except ReleaseError as exc:
        print(f"manage-release-branch: {exc}", file=sys.stderr)
        sys.exit(1)
