#!/usr/bin/env python3
"""Validate the blocking hook contract shared by supported agent platforms."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
from collections import Counter
from pathlib import Path
from typing import Callable, Optional


Contract = tuple[str, str, str]
CommandParser = Callable[[str], Optional[str]]

EXPECTED_CONTRACTS: tuple[Contract, ...] = (
    ("PreToolUse", "Edit|Write", "block-master-edit.sh"),
    ("PreToolUse", "Bash", "block-dangerous-git.sh"),
    ("PreToolUse", "Bash", "block-push-to-master.sh"),
    ("PreToolUse", "Bash", "confirm-release-action.sh"),
    (
        "PreToolUse",
        "mcp__gitee-ent__create_enterprise_repo_pull",
        "confirm-release-action.sh",
    ),
    (
        "PreToolUse",
        "mcp__gitee-ent__merge_enterprise_pull",
        "confirm-release-action.sh",
    ),
    (
        "PreToolUse",
        "mcp__gitee-ent__create_enterprise_repo_release",
        "confirm-release-action.sh",
    ),
    (
        "PreToolUse",
        "mcp__gitee-ent__create_enterprise_issue",
        "block-issue-without-repo.sh",
    ),
    (
        "PreToolUse",
        "mcp__gitee-ent__update_enterprise_issue",
        "block-issue-without-repo.sh",
    ),
    (
        "PostToolUse",
        "mcp__gitee-ent__create_enterprise_repo_pull",
        "confirm-release-action.sh",
    ),
    (
        "PostToolUse",
        "mcp__gitee-ent__merge_enterprise_pull",
        "confirm-release-action.sh",
    ),
    (
        "PostToolUse",
        "mcp__gitee-ent__create_enterprise_repo_release",
        "confirm-release-action.sh",
    ),
)

GATE_NAME = re.compile(r"[A-Za-z0-9._-]+\.sh")
CLAUDE_HOOK_PATH = re.compile(r".*/\.claude/hooks/([A-Za-z0-9._-]+\.sh)")
CODEX_WRAPPER = "$(git rev-parse --show-toplevel)/.codex/hooks/run-claude-pretool.sh"


def claude_gate(command: str) -> str | None:
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if len(parts) != 1:
        return None
    match = CLAUDE_HOOK_PATH.fullmatch(parts[0])
    return match.group(1) if match else None


def codex_gate(command: str) -> str | None:
    try:
        parts = shlex.split(command)
    except ValueError:
        return None

    if len(parts) == 2:
        wrapper, gate = parts
    elif len(parts) == 3 and Path(parts[0]).name in {"bash", "sh"}:
        _, wrapper, gate = parts
    else:
        return None
    if wrapper != CODEX_WRAPPER:
        return None
    return gate if GATE_NAME.fullmatch(gate) else None


def normalized_contracts(
    config: object,
    hook_keys: tuple[str, ...],
    command_parser: CommandParser,
) -> Counter[Contract]:
    hooks = config
    for key in hook_keys:
        hooks = hooks[key]  # type: ignore[index]

    contracts: Counter[Contract] = Counter()
    for event, items in hooks.items():  # type: ignore[union-attr]
        if event == "SessionStart":
            continue
        for item in items:
            matcher = item.get("matcher")
            if event == "PreToolUse" and matcher == "Grep|Glob":
                continue
            for hook in item.get("hooks", []):
                if hook.get("type") != "command":
                    raise ValueError(
                        f"无法解析阻断 Hook event={event} matcher={matcher} "
                        f"type={hook.get('type')}"
                    )
                command = hook.get("command", "")
                gate = command_parser(command)
                if gate is None:
                    raise ValueError(
                        f"无法解析阻断 Hook event={event} matcher={matcher} "
                        f"command={command}"
                    )
                contracts[(event, matcher, gate)] += 1
    return contracts


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--zcode", type=Path, default=root / ".zcode/config.json")
    parser.add_argument("--claude", type=Path, default=root / ".claude/settings.json")
    parser.add_argument("--codex", type=Path, default=root / ".codex/hooks.json")
    parser.add_argument("--hooks-dir", type=Path, default=root / ".claude/hooks")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    platforms = (
        ("ZCode", args.zcode, ("hooks", "events"), claude_gate),
        ("Claude Code", args.claude, ("hooks",), claude_gate),
        ("Codex", args.codex, ("hooks",), codex_gate),
    )
    expected = Counter(EXPECTED_CONTRACTS)
    runtime_pretool_gates = {
        gate for event, _matcher, gate in EXPECTED_CONTRACTS if event == "PreToolUse"
    }

    failed = False
    for platform, path, hook_keys, command_parser in platforms:
        try:
            config = json.loads(path.read_text())
            actual = normalized_contracts(config, hook_keys, command_parser)
        except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError, AttributeError) as error:
            print(f"{platform}: 无法解析 Hook 配置 {path}: {error}", file=sys.stderr)
            failed = True
            continue

        runtime_pretool_gates.update(
            gate for event, _matcher, gate in actual if event == "PreToolUse"
        )

        for (event, matcher, gate), expected_count in expected.items():
            actual_count = actual[(event, matcher, gate)]
            if actual_count < expected_count:
                print(
                    f"{platform}: 缺失 Hook 契约 "
                    f"event={event} matcher={matcher} gate={gate} "
                    f"expected_count={expected_count} actual_count={actual_count}",
                    file=sys.stderr,
                )
                failed = True
            elif actual_count > expected_count:
                print(
                    f"{platform}: 重复 Hook 契约 "
                    f"event={event} matcher={matcher} gate={gate} "
                    f"expected_count={expected_count} actual_count={actual_count}",
                    file=sys.stderr,
                )
                failed = True

        for event, matcher, gate in sorted(actual.keys() - expected.keys()):
            print(
                f"{platform}: 多余 Hook 契约 "
                f"event={event} matcher={matcher} gate={gate} "
                f"expected_count=0 actual_count={actual[(event, matcher, gate)]}",
                file=sys.stderr,
            )
            failed = True

    for gate in sorted(runtime_pretool_gates):
        path = args.hooks_dir / gate
        try:
            source = path.read_text()
        except OSError as error:
            print(f"审计覆盖检查: 无法读取运行时 Gate {path}: {error}", file=sys.stderr)
            failed = True
            continue
        if "lib/hook_audit.py" not in source or "--operation" not in source:
            print(
                f"审计覆盖检查: 运行时阻断型 PreToolUse Gate 未接入共享审计器 gate={gate}",
                file=sys.stderr,
            )
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
