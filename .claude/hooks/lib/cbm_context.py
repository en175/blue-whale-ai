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
        text = (f'[本仓 CBM] 当前目录 {root}。结构探索先 search_graph/trace_path；'
                f'已有查询证据可复用，文本/日志/配置检索可继续。遵循 {RULE}，降级需说明依据。')
    elif event in {'SessionStart', 'SubagentStart', 'UserPromptSubmit', 'CwdChanged'}:
        text = (f'[本仓 CBM] 当前工作树 {root}。代码探索前必读 {root / RULE}：'
                '先 list_projects/index_status 按 root_path 确认索引，缺索引先建立；'
                '结构问题先 search_graph/trace_path，再精读与核验覆盖。'
                '创建 worktree 只切换图谱，不是首次查询起点。'
                '子代理须显式接收规则、目录与图谱证据，并确认 MCP 可用性；'
                '收口说明查询支撑的结论或实际降级理由，建索引不算查询。')
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
