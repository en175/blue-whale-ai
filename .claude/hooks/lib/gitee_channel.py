#!/usr/bin/env python3
"""Reject visible Gitee browser/API alternatives without logging request values."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pretool import command_invocations

ROOT = Path(__file__).resolve().parents[3]
GITEE = re.compile(r"(?i)(?<![a-z0-9_.-])(?:[a-z0-9-]+\.)*gitee\.com(?=$|[^a-z0-9_.-])")
BROWSER = re.compile(r"(?i)browser|cua|playwright|puppeteer|tabbit|computer")
NETWORK = {"curl", "wget", "http", "httpie", "fetch"}
SHELL = {"Bash", "Shell", "exec_command", "RunShellCommand", "write_stdin"}


def common_dir(path: str) -> str:
    result = subprocess.run(["git", "-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ""


def strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in strings(v)]
    return []


def browser_reason(payload: dict) -> str | None:
    values = strings(payload)
    text = "\n".join(values)
    if GITEE.search(unquote(text)):
        return "blocked-gitee-browser"
    # Require an actual structured URL or a recognized acquisition/navigation call.
    urls = [payload[k] for k in ("url", "target_url", "page_url") if isinstance(payload.get(k), str)]
    code = payload.get("code", payload.get("script", ""))
    if isinstance(code, str):
        urls += re.findall(r"(?:createBrowserTab|goto|navigate|open)\s*\([^\n]*?[\"'](https?://[^\"']+)[\"']", code)
        urls += re.findall(r"(?:url|target_url|page_url)\s*:\s*[\"'](https?://[^\"']+)[\"']", code)
    if urls and all(urlsplit(u).scheme in {"http", "https"} and urlsplit(u).hostname for u in urls):
        return None
    return "blocked-unknown-browser-target"


def shell_reason(command: str, cwd: str) -> str | None:
    for call in command_invocations(command):
        executable = Path(call.executable).name
        interpreter = bool(re.fullmatch(r"python(?:\d+(?:\.\d+)*)?", executable)) or executable in {"node", "bun", "deno"}
        args = " ".join(call.args)
        if executable in NETWORK and GITEE.search(unquote(args)):
            return "blocked-gitee-http"
        if executable in {"open", "osascript"} and GITEE.search(unquote(args)):
            return "blocked-gitee-browser"
        if BROWSER.search(executable):
            return browser_reason({"code": args, "url": next((a for a in call.args if a.startswith(("http://", "https://"))), "")})
        if interpreter:
            if GITEE.search(unquote(args)) and re.search(r"(?i)requests\.|urllib|urlopen|fetch\s*\(|https?\.|goto\s*\(|cua\.|tabbit", args):
                return "blocked-gitee-http"
        # Inspect directly invoked local scripts, not arbitrary project files.
        candidate = Path(cwd) / call.executable
        if interpreter:
            script = next((a for a in call.args if not a.startswith("-")), "")
            if not any(a in {"-c", "-e", "--eval"} for a in call.args):
                candidate = Path(cwd) / script
        if candidate.is_file() and candidate.suffix in {".sh", ".py", ".js", ".mjs", ".ts"}:
            # This existing suite contains request strings as inert negative fixtures.
            if candidate.resolve() == ROOT / "scripts/test-hooks.sh":
                continue
            source = candidate.read_text(encoding="utf-8", errors="replace")
            if GITEE.search(unquote(source)) and re.search(r"(?i)curl\s|wget\s|requests\.|urlopen|fetch\s*\(|https?\.|goto\s*\(|cua\.|tabbit", source):
                return "blocked-gitee-script"
    return None


def reason(tool: str, payload: dict, cwd: str) -> str | None:
    if tool.startswith(("mcp__gitee-ent__", "mcp__gitee_ent__")):
        return None
    if BROWSER.search(tool):
        return browser_reason(payload)
    if tool in SHELL:
        return shell_reason(str(payload.get("command", payload.get("cmd", payload.get("chars", "")))), cwd)
    if tool in {"exec", "functions.exec"}:
        code = str(payload.get("code", payload.get("input", "")))
        if re.search(r"(?i)mcp__\w*(?:browser|cua|playwright|tabbit)\w*|cua\.", code):
            return browser_reason({"code": code})
        if GITEE.search(unquote(code)) and re.search(r"(?i)fetch\s*\(|requests\.|urlopen", code):
            return "blocked-gitee-http"
    if tool in {"WebFetch", "web_fetch", "web__run"} and GITEE.search(unquote("\n".join(strings(payload)))):
        return "blocked-gitee-http"
    if "open_in_codex" in tool:
        target = payload.get("target", {})
        if isinstance(target, dict) and target.get("type") == "browser":
            return browser_reason(target)
    return None


def main() -> int:
    raw = sys.stdin.read()
    try:
        event = json.loads(raw)
        if not isinstance(event, dict):
            raise ValueError("object required")
    except (ValueError, TypeError):
        print("BLOCKED: 无法解析渠道门禁输入。", file=sys.stderr)
        return 2
    cwd = event.get("cwd") or str(ROOT)
    if not isinstance(cwd, str):
        return 2
    # Shared Kimi/global routing must not affect unrelated repositories.
    if common_dir(cwd) != common_dir(str(ROOT)):
        return 0
    tool = event.get("tool_name", "")
    payload = event.get("tool_input", event.get("arguments", {}))
    if not isinstance(tool, str) or not tool or not isinstance(payload, dict):
        print("BLOCKED: 渠道门禁缺少工具名或结构化参数。", file=sys.stderr)
        return 2
    blocked = reason(tool, payload, cwd)
    code = 2 if blocked else 0
    subprocess.run([sys.executable, str(Path(__file__).with_name("hook_audit.py")), "--project-dir", cwd, "--hook", "block-gitee-alternative-channel.sh", "--operation", "gitee-channel", "--exit-code", str(code), "--reason", blocked or "allowed-channel"], input=raw, text=True, check=False)
    if blocked:
        print("BLOCKED: 本仓库工单与 PR 仅走 Gitee MCP；替代渠道或浏览器目标不明。按 agent-rules/gitee-mcp-only.md 报告阻塞，勿切换渠道。", file=sys.stderr)
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print("BLOCKED: 渠道门禁无法完成检查。", file=sys.stderr)
        sys.exit(2)
