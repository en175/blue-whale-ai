#!/usr/bin/env python3
"""Helpers for Claude Code PreToolUse hooks.

The shell hooks stay as small bash entrypoints, but security-sensitive parsing
belongs here: JSON strings can contain escaped quotes, and git commands can use
global options before the subcommand, e.g. `git -C ../wt push`.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from typing import Any


SEPARATORS = {";", "&", "&&", "|", "||", "(", ")"}
WORK_BRANCH_PREFIXES = ("feature/", "fix/", "hotfix/", "docs/", "chore/")
GIT_GLOBAL_OPTS_WITH_ARG = {
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--config-env",
}
PUSH_OPTS_WITH_ARG = {
    "--receive-pack",
    "--exec",
    "--repo",
    "--push-option",
    "--signed",
}


@dataclass
class GitInvocation:
    subcommand: str
    args: list[str]
    cwd: str | None


def load_pretool() -> dict[str, Any]:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def value(key: str) -> int:
    data = load_pretool()
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        tool_input = data
    if key == "tool_name":
        result = data.get("tool_name", tool_input.get("tool_name"))
    else:
        result = tool_input.get(key)
    if result is None:
        return 1
    if isinstance(result, bool):
        print("true" if result else "false")
    else:
        print(result)
    return 0


def shell_tokens(command: str) -> list[str]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return list(lexer)


def is_separator(token: str) -> bool:
    return token in SEPARATORS


def is_git_token(token: str) -> bool:
    return posixpath.basename(token) == "git"


def skip_option_with_optional_inline_arg(tokens: list[str], index: int, opts_with_arg: set[str]) -> int:
    token = tokens[index]
    if token in opts_with_arg:
        return index + 2
    for opt in opts_with_arg:
        if token.startswith(f"{opt}="):
            return index + 1
    if token.startswith("-C") and token != "-C":
        return index + 1
    if token.startswith("-c") and token != "-c":
        return index + 1
    return index + 1


def git_invocations(command: str) -> list[GitInvocation]:
    try:
        tokens = shell_tokens(command)
    except ValueError:
        # Fail closed for release-sensitive checks: a malformed shell string that
        # still mentions git push should be treated as a push by callers.
        if re.search(r"\bgit\b", command) and re.search(r"\bpush\b", command):
            return [GitInvocation(subcommand="push", args=[], cwd=None)]
        return []

    invocations: list[GitInvocation] = []
    index = 0
    while index < len(tokens):
        if not is_git_token(tokens[index]):
            index += 1
            continue

        index += 1
        cwd: str | None = None

        while index < len(tokens) and not is_separator(tokens[index]):
            token = tokens[index]
            if token == "--":
                index += 1
                break
            if token == "-C":
                if index + 1 < len(tokens):
                    cwd = tokens[index + 1]
                index += 2
                continue
            if token.startswith("-C") and token != "-C":
                cwd = token[2:]
                index += 1
                continue
            if token in GIT_GLOBAL_OPTS_WITH_ARG or any(
                token.startswith(f"{opt}=") for opt in GIT_GLOBAL_OPTS_WITH_ARG
            ):
                index = skip_option_with_optional_inline_arg(tokens, index, GIT_GLOBAL_OPTS_WITH_ARG)
                continue
            if token.startswith("-"):
                index += 1
                continue

            subcommand = token
            index += 1
            args: list[str] = []
            while index < len(tokens) and not is_separator(tokens[index]):
                args.append(tokens[index])
                index += 1
            invocations.append(GitInvocation(subcommand=subcommand, args=args, cwd=cwd))
            break

        while index < len(tokens) and not is_git_token(tokens[index]):
            if is_separator(tokens[index]):
                index += 1
                break
            index += 1

    return invocations


def push_invocations(command: str) -> list[GitInvocation]:
    return [inv for inv in git_invocations(command) if inv.subcommand == "push"]


def push_positionals(args: list[str]) -> list[str]:
    result: list[str] = []
    index = 0
    passthrough = False
    while index < len(args):
        arg = args[index]
        if not passthrough and arg == "--":
            passthrough = True
            index += 1
            continue
        if not passthrough and arg.startswith("-"):
            if arg in PUSH_OPTS_WITH_ARG or any(arg.startswith(f"{opt}=") for opt in PUSH_OPTS_WITH_ARG):
                index = skip_option_with_optional_inline_arg(args, index, PUSH_OPTS_WITH_ARG)
            else:
                index += 1
            continue
        result.append(arg)
        index += 1
    return result


def normalize_ref(refspec: str) -> str:
    refspec = refspec.lstrip("+")
    if ":" in refspec:
        refspec = refspec.rsplit(":", 1)[1]
    for prefix in ("refs/heads/", "heads/"):
        if refspec.startswith(prefix):
            refspec = refspec[len(prefix) :]
    return refspec


def explicit_targets(invocation: GitInvocation) -> list[str]:
    positionals = push_positionals(invocation.args)
    if len(positionals) <= 1:
        return []
    return [normalize_ref(refspec) for refspec in positionals[1:]]


def current_branch(cwd: str | None) -> str:
    cmd = ["git"]
    if cwd:
        cmd.extend(["-C", cwd])
    cmd.extend(["rev-parse", "--abbrev-ref", "HEAD"])
    try:
        return subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ""


def has_bare_force(args: list[str]) -> bool:
    for arg in args:
        if arg.startswith("--force-with-lease"):
            continue
        if arg == "--force" or arg.startswith("--force="):
            return True
        if arg == "-f":
            return True
    return False


def has_force_lease(args: list[str]) -> bool:
    return any(arg.startswith("--force-with-lease") for arg in args)


def mode_has_git_push(command: str) -> int:
    return 0 if push_invocations(command) else 1


def mode_protected_push_target(command: str) -> int:
    for invocation in push_invocations(command):
        targets = explicit_targets(invocation)
        if targets:
            for target in targets:
                if target in {"master", "main"}:
                    print(target)
                    return 0
        else:
            branch = current_branch(invocation.cwd)
            if branch in {"master", "main"}:
                print(branch)
                return 0
    return 1


def mode_push_has_bare_force(command: str) -> int:
    for invocation in push_invocations(command):
        if has_bare_force(invocation.args):
            return 0
    return 1


def mode_force_lease_non_work(command: str) -> int:
    for invocation in push_invocations(command):
        if not has_force_lease(invocation.args):
            continue
        targets = explicit_targets(invocation)
        target = targets[-1] if targets else current_branch(invocation.cwd)
        if not target.startswith(WORK_BRANCH_PREFIXES):
            print(target)
            return 0
    return 1


def mode_dangerous_pattern(command: str) -> int:
    for invocation in git_invocations(command):
        args = invocation.args
        if invocation.subcommand == "reset" and "--hard" in args:
            print("git reset --hard")
            return 0
        if invocation.subcommand == "clean" and any(arg.startswith("-") and "f" in arg for arg in args):
            print("git clean -f")
            return 0
        if invocation.subcommand == "branch" and "-D" in args:
            print("git branch -D")
            return 0
        if invocation.subcommand == "checkout" and "." in args:
            print("git checkout .")
            return 0
        if invocation.subcommand == "restore" and "." in args:
            print("git restore .")
            return 0
    return 1


def command_from_stdin() -> str:
    return sys.stdin.read()


def main() -> int:
    if len(sys.argv) < 2:
        return 2
    mode = sys.argv[1]
    if mode == "value":
        if len(sys.argv) != 3:
            return 2
        return value(sys.argv[2])

    command = command_from_stdin()
    if mode == "has-git-push":
        return mode_has_git_push(command)
    if mode == "protected-push-target":
        return mode_protected_push_target(command)
    if mode == "push-has-bare-force":
        return mode_push_has_bare_force(command)
    if mode == "force-lease-non-work":
        return mode_force_lease_non_work(command)
    if mode == "dangerous-pattern":
        return mode_dangerous_pattern(command)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
