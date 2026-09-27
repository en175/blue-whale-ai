#!/usr/bin/env python3
"""Sync the complete implement-spec skill within the current checkout."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path


def files(root: Path, directory: Path) -> set[Path]:
    for path in (directory, *directory.parents):
        if path == root:
            break
        if path.is_symlink():
            raise ValueError(f"保留符号链接，先核查目标：{path.relative_to(root)}")
        if path.exists() and not path.is_dir():
            raise ValueError(f"路径须为目录，保留现有内容：{path.relative_to(root)}")
    entries = list(directory.rglob("*"))
    for path in entries:
        if path.is_symlink():
            raise ValueError(f"保留符号链接，先核查目标：{path.relative_to(root)}")
    return {path.relative_to(directory) for path in entries if path.is_file()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="只检查一致性，有差异时退出 1")
    mode.add_argument("--dry-run", action="store_true", help="只列出差异，不写入")
    args = parser.parse_args()
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    source = root / ".claude/skills/implement-spec"
    if not (source / "SKILL.md").is_file():
        raise ValueError("缺少权威源 .claude/skills/implement-spec/SKILL.md")
    expected = files(root, source)
    targets = [root / path / "skills/implement-spec" for path in (".zcode", ".agents", ".qoder")]
    kimi = root / ".kimi-code/skills/implement-spec"
    if kimi.exists() or kimi.is_symlink():
        targets.append(kimi)

    # Validate every target before copying any file.
    changes = []
    for target in targets:
        actual = files(root, target)
        extras = actual - expected
        if extras:
            names = ", ".join(str(path) for path in sorted(extras))
            raise ValueError(f"保留目标中的额外文件，先核查：{target.relative_to(root)}：{names}")
        for rel in expected:
            destination = target / rel
            if destination.exists() and not destination.is_file():
                raise ValueError(f"路径须为文件，保留现有内容：{destination.relative_to(root)}")
        changed = [rel for rel in sorted(expected)
                   if not (target / rel).is_file()
                   or (source / rel).read_bytes() != (target / rel).read_bytes()]
        changes.append((target, changed))

    for target, changed in changes:
        label = target.relative_to(root)
        if args.check or args.dry_run:
            print(f"{label}：" + ("一致" if not changed else "待同步 " + ", ".join(map(str, changed))))
            continue
        for rel in changed:
            destination = target / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source / rel, destination)
        print(f"{label}：已核对 {len(expected)} 个文件，更新 {len(changed)} 个")
    return int(args.check and any(changed for _, changed in changes))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc))
