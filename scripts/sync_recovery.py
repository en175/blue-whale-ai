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


def load_recovery(path: Path) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RecoveryError("同步恢复点无法读取：{}".format(exc)) from exc
    if not isinstance(data, dict):
        raise RecoveryError("同步恢复点必须是 JSON object。")
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
