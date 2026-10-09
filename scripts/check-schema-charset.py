#!/usr/bin/env python3

from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_DIR = REPO_ROOT / "backend" / "prisma" / "schema"
REQUIRED = "SET NAMES utf8mb4"


def main() -> int:
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
