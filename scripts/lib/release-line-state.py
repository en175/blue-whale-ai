#!/usr/bin/env python3
"""Manage one team-wide active release line through a remote Git branch."""

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path

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


def candidates(state, branches):
    if state is None:
        return branches
    active = state["active"]
    if not active.startswith("release/") or active not in branches:
        raise ReleaseError(f"已启用的 {active} 在远端不存在，状态不一致。")
    if any(not x.startswith("release/") for x in state["legacy"]):
        raise ReleaseError("共享状态包含非法历史分支。")
    return [x for x in branches if x != active and x not in state["legacy"]]


def worktrees():
    output = git("worktree", "list", "--porcelain").stdout
    rows, path, branch = [], None, None
    for line in output.splitlines() + [""]:
        if not line:
            if path and branch and branch != "refs/heads/master":
                rows.append({"path": path, "branch": branch.removeprefix("refs/heads/")})
            path = branch = None
        elif line.startswith("worktree "):
            path = line[9:]
        elif line.startswith("branch "):
            branch = line[7:]
    return rows


def emit(data, as_json, message):
    print(json.dumps(data, ensure_ascii=False, separators=(",", ":")) if as_json else message)


def current(args):
    refresh()
    branches = releases()
    sha, state = read_state()
    if state is None:
        raise ReleaseError("团队尚未启用当前发布线；请由负责人清点并执行 activate。")
    pending = candidates(state, branches)
    if pending:
        raise ReleaseError("发现未经授权的候选，停止自动选择：" + ", ".join(pending))
    emit({"branch": state["active"], "state_sha": sha, "candidates": pending,
          "legacy": state["legacy"]}, args.json, f"当前发布线：{state['active']}（状态 {sha}）")


def listing(args):
    refresh()
    branches = releases()
    sha, state = read_state()
    pending = candidates(state, branches)
    data = {"branch": state["active"] if state else None, "state_sha": sha,
            "candidates": pending, "legacy": state["legacy"] if state else [],
            "recent": recent_releases(args.count),
            "task_worktrees": worktrees()}
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
    print("历史分支：" + (", ".join(data["legacy"]) or "无"))
    print("任务 worktree（归属待核对）：")
    for item in data["task_worktrees"]:
        print(f"  {item['branch']}  {item['path']}")
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


def assert_closed(old, snapshot):
    if git("rev-parse", "--verify", "origin/master", check=False).returncode:
        raise ReleaseError("origin/master 不可用，无法核实旧批次。")
    if git("merge-base", "--is-ancestor", f"origin/{old}", "origin/master",
           check=False).returncode:
        raise ReleaseError(f"旧活动发布线 {old} 尚未进入 origin/master，拒绝换期。")
    open_pulls = pr_snapshot(snapshot, old)
    if open_pulls:
        numbers = ", ".join(str(p.get("number", p.get("id", "?"))) for p in open_pulls)
        raise ReleaseError(f"旧活动发布线仍有开放 PR：{numbers}；请负责人决定去向。")


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
    assert_main()
    validate(args.branch)
    refresh()
    branches = releases()
    previous, state = read_state()
    if args.branch not in branches:
        raise ReleaseError(f"目标发布线 {args.branch} 在远端不存在。")
    if state is None:
        others = [x for x in branches if x != args.branch]
        if others and not args.adopt_legacy:
            raise ReleaseError("首次启用发现多条分支，请清点后显式传 --adopt-legacy：" + ", ".join(others))
        if others:
            open_pulls = pr_snapshot(args.pr_snapshot, others)
            if open_pulls:
                details = ", ".join(
                    f"!{p.get('number', p.get('id', '?'))} 的目标为 {p['target_branch']}"
                    for p in open_pulls
                )
                raise ReleaseError("待归档分支仍有开放 PR，请负责人决定去向：" + details)
        legacy = others
    else:
        pending = candidates(state, branches)
        if args.branch == state["active"]:
            if pending:
                raise ReleaseError("还有待授权候选：" + ", ".join(pending))
            emit({"branch": args.branch, "state_sha": previous, "candidates": [],
                  "legacy": state["legacy"]}, args.json, f"当前已启用：{args.branch}")
            return
        if len(pending) != 1 or pending[0] != args.branch:
            raise ReleaseError("候选不唯一或目标并非唯一候选：" + ", ".join(pending))
        assert_closed(state["active"], args.pr_snapshot)
        legacy = state["legacy"] + [state["active"]]
    sha = write_state(previous, args.branch, legacy)
    emit({"branch": args.branch, "state_sha": sha, "candidates": [],
          "legacy": legacy, "task_worktrees": worktrees()},
         args.json, f"已启用发布线：{args.branch}（状态 {sha}）")


def create(args):
    if not args.user_authorized:
        raise ReleaseError("创建 release 分支需负责人授权并传 --user-authorized。")
    assert_main()
    if args.summary and (any(x in args.summary for x in "_-/\\")
                         or any(x.isspace() for x in args.summary)):
        raise ReleaseError("描述禁止包含空格、下划线、连字符、斜杠或反斜杠。")
    refresh()
    branches = releases()
    previous, state = read_state()
    if state:
        pending = candidates(state, branches)
        if pending:
            raise ReleaseError("已有待授权候选，不能继续创建：" + ", ".join(pending))
        assert_closed(state["active"], args.pr_snapshot)
        legacy = state["legacy"] + [state["active"]]
    elif branches:
        raise ReleaseError("已有远端 release 分支但尚未启用当前线，请先清点并 activate：" + ", ".join(branches))
    else:
        legacy = []
    branch = "release/" + dt.datetime.now().strftime("%Y.%m.%d")
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
    except ReleaseError as exc:
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
    args = parser.parse_args()
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
