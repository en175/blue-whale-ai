#!/usr/bin/env python3
"""Single atomic persistence boundary for task-sync recovery records."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path


class RecoveryError(RuntimeError):
    pass


def _restrict_to_owner(path: Path) -> None:
    if os.name == "nt":
        owner = getpass.getuser() or os.environ.get("USERNAME") or os.environ.get("USER")
        try:
            subprocess.run(
                [
                    "icacls",
                    str(path),
                    "/inheritance:r",
                    "/grant:r",
                    "{}:F".format(owner),
                ],
                check=True,
                capture_output=True,
                encoding="utf-8",
                errors="replace",
            )
        except (OSError, subprocess.CalledProcessError):
            pass
    else:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def load_record(path: Path) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RecoveryError("同步恢复点无法读取：{}".format(exc)) from exc
    if not isinstance(data, dict):
        raise RecoveryError("同步恢复点必须是 JSON object。")
    return data


def require_keys(data: dict[str, object], keys: tuple[str, ...], location: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise RecoveryError("同步恢复点无法读取：{} 缺少必填键 {}。".format(
            location, ", ".join(missing)))


def load_recovery(path: Path) -> dict[str, object]:
    data = load_record(path)
    require_keys(data, ("version", "branch", "original_head", "upstream_sha",
                        "target_branch", "remote_branch_sha", "backup_ref", "created_at"),
                 "顶层")
    proofs = data.get("rebase_proofs", [])
    if not isinstance(proofs, list) or any(not isinstance(proof, dict) for proof in proofs):
        raise RecoveryError("同步恢复点无法读取：rebase_proofs 必须是 JSON object 列表。")
    for index, proof in enumerate(proofs):
        require_keys(proof, ("original_head", "upstream_sha", "synced_head", "merged_tree"),
                     f"rebase_proofs[{index}]")
        conflict_keys = ("auto_tree", "conflict_files", "resolved_files")
        if any(key in proof for key in conflict_keys):
            require_keys(proof, conflict_keys, f"rebase_proofs[{index}] 冲突证明")
    conflict_keys = ("rebase_auto_tree", "rebase_conflict_files", "rebase_resolved_files")
    if any(key in data for key in conflict_keys):
        require_keys(data, ("rebase_tree", *conflict_keys), "冲突解决证明")
    if proofs or data.get("rebase_tree"):
        require_keys(data, ("child_heads",), "同步证明")
    if data.get("rebase_tree"):
        require_keys(data, ("synced_head",), "同步文件树")
    if data.get("manual_rebase"):
        require_keys(data, ("rebase_input_head", "rebase_input_ref"), "冲突 rebase")
    if any(key in data for key in ("linearized_pr", "frozen_files", "original_tree", "linearized_head")):
        require_keys(data, ("linearized_pr", "frozen_files", "original_tree", "child_heads"), "PR 线性化")
        if "synced_head" in data or "linearized_head" in data:
            require_keys(data, ("synced_head", "linearized_head"), "已线性化提交")
    if "push_state" in data or "pushed_head" in data:
        require_keys(data, ("push_state", "pushed_head", "synced_head"), "推送阶段")
    if "verified_head" in data or "verified_pr_iid" in data:
        require_keys(data, ("verified_head", "verified_pr_iid"), "PR 核验阶段")
    return data


def write_recovery(path: Path, data: dict[str, object]) -> None:
    temporary = Path(str(path) + ".tmp")
    try:
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        _restrict_to_owner(temporary)
        temporary.replace(path)
    except OSError as exc:
        raise RecoveryError("同步恢复点无法原子写入：{}".format(exc)) from exc


def set_push_state(path: Path, head: str, state: str) -> None:
    data = load_recovery(path)
    if state == "clear":
        data.pop("pushed_head", None)
        data.pop("push_state", None)
    else:
        data["pushed_head"] = head
        data["push_state"] = state
    write_recovery(path, data)


def record_verification(path: Path, head: str, iid: int) -> None:
    data = load_recovery(path)
    if data.get("pushed_head") != head or data.get("push_state") != "pushed":
        raise RecoveryError("同步恢复点未记录当前 HEAD 的成功推送。")
    data["verified_head"] = head
    data["verified_pr_iid"] = iid
    write_recovery(path, data)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    state = subparsers.add_parser("set-push-state")
    state.add_argument("path", type=Path)
    state.add_argument("head")
    state.add_argument("state", choices=("in_flight", "pushed", "clear"))
    verify = subparsers.add_parser("record-verification")
    verify.add_argument("path", type=Path)
    verify.add_argument("head")
    verify.add_argument("iid", type=int)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        if args.action == "set-push-state":
            set_push_state(args.path, args.head, args.state)
        else:
            record_verification(args.path, args.head, args.iid)
        return 0
    except RecoveryError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
