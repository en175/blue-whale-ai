#!/usr/bin/env python3
"""Read-only check of the repository's project skill entry points."""

import os
import subprocess
import sys
from pathlib import Path


AUTHORITY = Path(".agents/skills")
AGENTS_ROOT = AUTHORITY.parent
GENERATED_BUILD = AUTHORITY / "deploy-blue-whale-api/.build"
CLAUDE_ENTRY = Path(".claude/skills")
CLIENT_ENTRIES = (
    Path(".codex/skills"),
    Path(".kimi-code/skills"),
    Path(".zcode/skills"),
    Path(".qoder/skills"),
)


def tracked_paths(root):
    result = subprocess.run(
        ["git", "ls-files", "--stage", "-z", "--", str(AGENTS_ROOT), str(CLAUDE_ENTRY)],
        cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    )
    return {
        Path(os.fsdecode(entry.split(b"\t", 1)[1])): entry.split(b" ", 1)[0].decode()
        for entry in result.stdout.split(b"\0") if entry
    }


def files_under(directory):
    for current, folders, files in os.walk(directory, followlinks=False):
        for name in folders + files:
            yield Path(current, name)


def package_files(directory):
    return {
        path.relative_to(directory): path.read_bytes()
        for path in files_under(directory)
        if path.is_file() and not path.is_symlink()
    }


def check(root, home):
    errors = []
    notices = []
    agents = root / AGENTS_ROOT
    authority = root / AUTHORITY
    generated_build = root / GENERATED_BUILD
    claude = root / CLAUDE_ENTRY
    tracked = tracked_paths(root)

    if not agents.is_dir() or agents.is_symlink() or not authority.is_dir() or authority.is_symlink():
        errors.append(f"{AUTHORITY}: 必须是当前工作树内的实际目录")
        names = set()
    else:
        names = {path.name for path in authority.iterdir() if path.is_dir() and not path.is_symlink()}
        if not names:
            errors.append(f"{AUTHORITY}: 没有技能包")
        for path in authority.iterdir():
            if not path.is_dir() or path.is_symlink():
                errors.append(f"{path.relative_to(root)}: 权威目录中有未知或链接内容")
            elif not (path / "SKILL.md").is_file():
                errors.append(f"{path.relative_to(root)}: 缺少 SKILL.md")
        for path in files_under(agents):
            relative = path.relative_to(root)
            if (relative.is_relative_to(GENERATED_BUILD)
                    and generated_build.is_dir() and not generated_build.is_symlink()):
                continue
            if path.is_symlink():
                errors.append(f"{relative}: .agents 包含符号链接，请改为入库文件")
            elif path.is_file() and relative not in tracked:
                errors.append(f"{relative}: 未纳入 Git，新的工作树不会取得此文件")
            elif path.is_dir() and not relative.is_relative_to(AUTHORITY):
                if not any(relative in tracked_path.parents for tracked_path in tracked):
                    errors.append(f"{relative}: 未纳入 Git，新的工作树不会取得此目录")
        for relative in sorted(tracked):
            if relative == CLAUDE_ENTRY:
                continue
            if not (root / relative).is_file():
                errors.append(f"{relative}: Git 跟踪的文件缺失")

    if not claude.is_symlink():
        state = "普通目录" if claude.is_dir() else "丢失或平台未保留符号链接"
        errors.append(f"{CLAUDE_ENTRY}: {state}，应为指向 ../.agents/skills 的 Git 符号链接")
    elif os.readlink(claude) != "../.agents/skills" or not claude.resolve().is_relative_to(root.resolve()):
        errors.append(f"{CLAUDE_ENTRY}: 指向错误位置 {os.readlink(claude)!r}")
    if CLAUDE_ENTRY not in tracked:
        errors.append(f"{CLAUDE_ENTRY}: 符号链接未纳入 Git，新工作树会缺失")
    elif tracked[CLAUDE_ENTRY] != "120000":
        errors.append(f"{CLAUDE_ENTRY}: Git 中不是符号链接，新工作树无法保留目录引用")

    for relative in CLIENT_ENTRIES:
        entry = root / relative
        if not entry.exists() and not entry.is_symlink():
            continue
        if entry.is_symlink():
            errors.append(f"{relative}: 额外项目入口链接会重复注册技能")
            continue
        if not entry.is_dir():
            errors.append(f"{relative}: 未知项目技能入口")
            continue
        for path in sorted(entry.iterdir()):
            candidate = path.name
            location = path.relative_to(root)
            if candidate not in names:
                errors.append(f"{location}: 权威目录外的额外项目技能")
            elif not path.is_dir() or path.is_symlink():
                errors.append(f"{location}: 重复项目技能入口，来源不是权威目录")
            elif package_files(path) != package_files(authority / candidate):
                errors.append(f"{location}: 过期生成副本，且会重复注册项目技能")
            else:
                errors.append(f"{location}: 生成副本会重复注册项目技能")

    for relative in (AUTHORITY, *CLIENT_ENTRIES, CLAUDE_ENTRY, Path(".qoder-cn/skills")):
        personal = home / relative
        if not personal.is_dir():
            continue
        for name in sorted(names):
            if (personal / name / "SKILL.md").is_file():
                notices.append(f"个人同名技能: {name}，项目来源 {AUTHORITY / name}，个人来源 {personal / name}")

    return errors, sorted(set(notices)), len(names)


def main():
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    errors, notices, count = check(root, Path.home())
    for line in notices:
        print(line)
    for line in errors:
        print(f"错误: {line}", file=sys.stderr)
    if errors:
        print(f"工程技能校验失败，共 {len(errors)} 项", file=sys.stderr)
        return 1
    print(f"工程技能校验通过，共 {count} 个项目技能；入口: .agents/skills、.claude/skills")
    return 0


if __name__ == "__main__":
    sys.exit(main())
