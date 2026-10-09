#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import sys
try:
    import fcntl
except ImportError:
    fcntl = None
try:
    import msvcrt
except ImportError:
    msvcrt = None
from datetime import datetime, timezone
from pathlib import Path

MAX_BYTES = 10 * 1024 * 1024
LOG_DIR_NAME = "hook-audit"


def git_common_dir(project_dir: str) -> Path:
    root = Path(project_dir).resolve()
    result = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "--git-common-dir"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    common = result.stdout.strip()
    if not common:
        common = str(root / ".git")
    common_path = Path(common)
    if not common_path.is_absolute():
        common_path = root / common_path
    return common_path


def log_paths(project_dir: str, hook_name: str) -> tuple[Path, Path, Path]:
    base = git_common_dir(project_dir) / LOG_DIR_NAME
    safe_name = hook_name.replace("/", "_")
    active = base / f"{safe_name}.log"
    archive = base / f"{safe_name}.log.1"
    lock = base / f"{safe_name}.log.lock"
    return active, archive, lock


def _scalar_str(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    return ""


def read_upstream_fields(include_file_context: bool) -> dict[str, str]:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        tool_input = {}
    return {
        "tool": _scalar_str(data.get("tool_name")),
        "tool_use_id": _scalar_str(data.get("tool_use_id") or data.get("tool_call_id")),
        "session_id": _scalar_str(data.get("session_id")),
        "file_path": _scalar_str(
            tool_input.get("file_path") or tool_input.get("path") or data.get("file_path")
        )
        if include_file_context
        else "",
    }


def maybe_rotate(active: Path, archive: Path) -> None:
    try:
        size = active.stat().st_size
    except FileNotFoundError:
        return
    if size < MAX_BYTES:
        return
    if archive.exists():
        archive.unlink()
    active.rename(archive)


def append_record(
    active: Path,
    archive: Path,
    lock: Path,
    record: dict,
) -> None:
    active.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(lock, "a+") as lock_fd:
        locked = False
        try:
            if fcntl is not None:
                fcntl.flock(lock_fd.fileno(), fcntl.LOCK_EX)
                locked = True
            elif msvcrt is not None:
                try:
                    msvcrt.locking(lock_fd.fileno(), msvcrt.LK_LOCK, 1)
                    locked = True
                except OSError:
                    pass
            maybe_rotate(active, archive)
            with open(active, "a") as log_fd:
                log_fd.write(line)
            maybe_rotate(active, archive)
        finally:
            if locked:
                if fcntl is not None:
                    fcntl.flock(lock_fd.fileno(), fcntl.LOCK_UN)
                else:
                    try:
                        msvcrt.locking(lock_fd.fileno(), msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass


def run() -> int:
    parser = argparse.ArgumentParser(description="Append a hook audit record.")
    parser.add_argument("--project-dir", required=True,
                        help="git work tree toplevel (for resolving git-common-dir)")
    parser.add_argument("--hook", required=True,
                        help="hook script name, e.g. block-master-edit.sh")
    parser.add_argument("--branch", default="",
                        help="resolved branch of the target file_path (empty if detached)")
    parser.add_argument("--include-file-context", action="store_true",
                        help="record file_path/branch for the master Edit/Write gate")
    parser.add_argument("--operation", required=True,
                        help="bounded stable operation category chosen by the gate")
    parser.add_argument("--exit-code", required=True,
                        help="exit code the hook will return (0 or 2)")
    parser.add_argument("--reason", required=True,
                        help="short stable reason tag, e.g. blocked-master")
    args = parser.parse_args()

    upstream = read_upstream_fields(args.include_file_context)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hook": args.hook,
        "tool": upstream["tool"],
        "file_path": upstream["file_path"],
        "branch": args.branch if args.include_file_context else "",
        "operation": args.operation[:64],
        "session_id": upstream["session_id"],
        "tool_use_id": upstream["tool_use_id"],
        "exit_code": int(args.exit_code),
        "reason": args.reason,
    }

    active, archive, lock = log_paths(args.project_dir, args.hook)
    append_record(active, archive, lock, record)
    return 0


def main() -> int:
    try:
        return run()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"hook-audit: degraded ({type(exc).__name__})", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
