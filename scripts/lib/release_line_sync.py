"""Synchronize the active local release checkout with its remote branch."""

import errno
import json
import os
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path


class SyncError(RuntimeError):
    pass


def git(root, *args, check=True):
    result = subprocess.run(
        ["git", "-C", str(root), *args], text=True, encoding="utf-8",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode:
        raise SyncError((result.stderr or result.stdout).strip() or f"git {' '.join(args)} 失败")
    return result


def git_path(root, name):
    value = Path(git(root, "rev-parse", "--git-path", name).stdout.strip())
    return value if value.is_absolute() else root / value


@contextmanager
def release_line_lock(root):
    """Hold this lock through sync AND worktree creation when starting a task."""
    value = Path(git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.strip())
    lock_path = value / "blue-whale" / "release-line-sync.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as lock_file:
        if os.name == "nt":
            import msvcrt

            while True:
                lock_file.seek(0)
                try:
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as exc:
                    if exc.errno not in (errno.EACCES, errno.EAGAIN) and getattr(exc, "winerror", None) != 33:
                        raise
                    time.sleep(0.1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def status(root):
    return git(root, "status", "--short", "--untracked-files=all").stdout.splitlines()


def ancestor(root, older, newer):
    result = git(root, "merge-base", "--is-ancestor", older, newer, check=False)
    if result.returncode not in (0, 1):
        raise SyncError("无法比较发布线提交：" + (result.stderr or result.stdout).strip())
    return result.returncode == 0


def current_line(root):
    # manage-release-branch.sh delegates to this same Python authority. Calling it
    # directly also works from PowerShell, where bare "bash" may launch WSL.
    command = [sys.executable, str(root / "scripts/lib/release-line-state.py"), "current", "--json"]
    result = subprocess.run(command, cwd=root, text=True, encoding="utf-8",
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if result.returncode:
        raise SyncError("无法确认当前发布线：" + (result.stderr or result.stdout).strip())
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SyncError("当前发布线入口未返回有效 JSON。") from exc
    if not isinstance(data, dict) or not isinstance(data.get("branch"), str) or not data["branch"].startswith("release/") or not data.get("state_sha"):
        raise SyncError("当前发布线入口缺少 branch 或 state_sha。")
    return data


def sync_current_release(root):
    """Synchronize inside release_line_lock; caller may then create a worktree."""
    root = Path(root).resolve()
    top = Path(git(root, "rev-parse", "--show-toplevel").stdout.strip()).resolve()
    if not os.path.samefile(root, top):
        raise SyncError("请从本地发布线工作树根目录运行同步入口。")
    active = [name for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply")
              if git_path(root, name).exists()]
    if active:
        raise SyncError("存在未结束的 Git 操作：" + ", ".join(active))
    line = current_line(root)
    branch = line["branch"]
    local_branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD", check=False).stdout.strip()
    if local_branch != branch:
        raise SyncError(f"当前目录检出 {local_branch or 'detached HEAD'}，活动发布线为 {branch}；请切换到对应本地发布线目录。")
    remote = f"refs/remotes/origin/{branch}"
    if git(root, "rev-parse", "--verify", "--quiet", remote, check=False).returncode:
        raise SyncError(f"本次抓取后找不到远端 {branch}，无法确认最新代码。")
    before = git(root, "rev-parse", "HEAD").stdout.strip()
    remote_sha = git(root, "rev-parse", remote).stdout.strip()
    if ancestor(root, remote_sha, before):
        action = "same" if remote_sha == before else "local_ahead"
    else:
        merge_args = ["merge", "--ff-only"] if ancestor(root, before, remote_sha) else ["merge", "--no-ff", "--no-edit", "-m", "chore: 同步当前发布线远端提交"]
        result = git(root, *merge_args, remote, check=False)
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            if git_path(root, "MERGE_HEAD").exists():
                abort = git(root, "merge", "--abort", check=False)
                if abort.returncode:
                    raise SyncError("发布线合并失败，自动 abort 也失败；请检查未完成的 Git 合并。"
                                    f"合并输出：{detail}；abort 输出：{(abort.stderr or abort.stdout).strip()}；当前 HEAD：{git(root, 'rev-parse', 'HEAD').stdout.strip()}；工作区：{status(root)}")
                raise SyncError(f"发布线合并冲突，已自动 abort；原 HEAD：{before}；工作区：{status(root)}；合并输出：{detail}")
            raise SyncError(f"发布线同步停止，原 HEAD：{before}；工作区：{status(root)}；Git 输出：{detail}")
        action = "fast_forward" if merge_args[1] == "--ff-only" else "merged"
    final_sha = git(root, "rev-parse", "HEAD").stdout.strip()
    if not ancestor(root, before, final_sha) or not ancestor(root, remote_sha, final_sha):
        raise SyncError("同步后提交祖先关系不符合预期，请检查发布线历史。")
    return {"branch": branch, "sha": final_sha, "remote_sha": remote_sha,
            "state_sha": line["state_sha"], "action": action,
            "worktree_path": str(root), "cbm_root_path": str(root),
            "cbm_check_required": True, "dirty_paths": status(root)}
