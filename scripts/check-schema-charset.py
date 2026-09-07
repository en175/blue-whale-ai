#!/usr/bin/env python3
"""Verify every schema SQL declares SET NAMES utf8mb4.

Regression guard: packages/persistence/schema/*.sql are imported through
docker-entrypoint-initdb.d, whose client session defaults to latin1 unless
the file declares SET NAMES utf8mb4. Without it, UTF-8 Chinese seed data is
double-encoded into mojibake at insert time (对照组: 001_baseline.sql).
"""

from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = REPO_ROOT / "packages" / "persistence" / "schema"
REQUIRED = "SET NAMES utf8mb4"


def main() -> int:
    # Windows 原生 Python 默认 stdout 为 cp936（GBK），打印 `✅`（U+2705，非 GBK
    # 字符）直接抛 UnicodeEncodeError；强制改 UTF-8。POSIX 本就 UTF-8，reconfigure
    # 为 no-op。
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    sql_files = sorted(SCHEMA_DIR.glob("*.sql"))
    if not sql_files:
        print(f"❌ 未找到任何 schema SQL：{SCHEMA_DIR}", file=sys.stderr)
        return 1

    missing = [f for f in sql_files if REQUIRED not in f.read_text(encoding="utf-8")]
    if missing:
        print(f"❌ 以下 schema SQL 缺少 `{REQUIRED}`：", file=sys.stderr)
        for f in missing:
            print(f"  {f.relative_to(REPO_ROOT)}", file=sys.stderr)
        return 1

    print(f"✅ {len(sql_files)} 个 schema SQL 均声明 `{REQUIRED}`")
    return 0


if __name__ == "__main__":
    sys.exit(main())
