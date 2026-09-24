#!/usr/bin/env python3
"""Standard entry for code work in the active local release checkout."""

import argparse
import json
import os
import sys
from pathlib import Path

from lib.release_line_sync import SyncError, release_line_lock, sync_current_release


def main():
    parser = argparse.ArgumentParser(description="同步当前本地发布线并报告实际代码目录")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = Path.cwd().resolve()
    if not os.path.samefile(root / "scripts/sync-release-line.py", Path(__file__)):
        raise SyncError("请从此脚本所属的发布线工作树根目录运行。")
    with release_line_lock(root):
        result = sync_current_release(root)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    else:
        print(f"当前发布线：{result['branch']}；本地提交：{result['sha']}；同步结果：{result['action']}")
        print(f"代码目录与 CBM 索引 root_path：{result['cbm_root_path']}；请按该目录核对索引状态。")
        if result["dirty_paths"]:
            print("本机未提交文件仅供本次分析参考：" + ", ".join(result["dirty_paths"]))


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print(f"sync-release-line: {exc}", file=sys.stderr)
        sys.exit(1)
