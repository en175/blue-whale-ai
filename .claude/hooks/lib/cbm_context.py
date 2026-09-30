"""Nonblocking repository CBM reminder; client adapters contain no policy."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
RULE = 'agent-rules/code-discovery.md'


def git_path(cwd: Path, option: str) -> Path:
    result = subprocess.run(['git', '-C', str(cwd), 'rev-parse', '--path-format=absolute', option],
                            capture_output=True, text=True, check=True, timeout=2)
    return Path(result.stdout.strip()).resolve()


def main() -> None:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict) or not isinstance(payload.get('cwd'), str):
        return
    cwd = Path(payload['cwd']).resolve()
    if git_path(cwd, '--git-common-dir') != git_path(ROOT, '--git-common-dir'):
        return
    root = git_path(cwd, '--show-toplevel')
    event = payload.get('hook_event_name')
    kimi = payload.get('client_type') == 'kimi_code_cli' or event == 'UserPromptSubmit'
    if kimi and event != 'UserPromptSubmit':
        return  # Kimi lifecycle events are observation-only; use its prompt context seam.
    if event == 'PreToolUse':
        tool = payload.get('tool_name', '')
        args = payload.get('tool_input', {})
        if not isinstance(args, dict):
            return
        if tool in {'Bash', 'exec_command', 'Shell'}:
            command = args.get('command', args.get('cmd', ''))
            if not isinstance(command, str) or not re.search(r'\b(?:rg|grep|find|ls)\b', command):
                return
        elif tool not in {'Grep', 'Glob'}:
            return
        text = f'[本仓 CBM] 当前目录 {root}。结构探索前读取 {root / RULE}，按协议执行。'
    elif event in {'SessionStart', 'SubagentStart', 'UserPromptSubmit', 'CwdChanged'}:
        text = f'[本仓 CBM] 当前工作树 {root}。代码探索或子代理交接前读取 {root / RULE}，按协议执行。'
    else:
        return
    if kimi:
        print(text)
    else:
        print(json.dumps({'hookSpecificOutput': {'hookEventName': event,
                                                'additionalContext': text}}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        pass  # Reminders never interrupt work or emit data from failing commands.
