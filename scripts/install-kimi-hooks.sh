#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNIPPET="$REPO_ROOT/.kimi-code/hooks.toml"
SHIM_SRC="$REPO_ROOT/.kimi-code/hooks/blue-whale-hook.sh"
PONYTAIL_SRC="$REPO_ROOT/.kimi-code/hooks/ponytail-hook.js"

KIMI_HOME="${KIMI_CODE_HOME:-$HOME/.kimi-code}"
CONFIG="$KIMI_HOME/config.toml"
SHIM_DIR="$KIMI_HOME/hooks"
SHIM_DST="$SHIM_DIR/blue-whale-hook.sh"
PONYTAIL_DST="$SHIM_DIR/ponytail-hook.js"

BEGIN_MARK="# >>> blue-whale-ai kimi hooks (managed by scripts/install-kimi-hooks.sh) >>>"
END_MARK="# <<< blue-whale-ai kimi hooks (managed by scripts/install-kimi-hooks.sh) <<<"

usage() {
  echo "usage: install-kimi-hooks.sh [--uninstall|--uninstall-ponytail]" >&2
  exit 2
}

[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && { [ "$1" = "--uninstall" ] || [ "$1" = "--uninstall-ponytail" ]; }; } || usage
python3 -c 'import tomllib' >/dev/null 2>&1 || {
  echo "安装与卸载需要 PATH 中的 Python 3.11 以上版本。" >&2
  exit 1
}

managed_block() {
  python3 - "$CONFIG" "$BEGIN_MARK" "$END_MARK" "$SNIPPET" "$1" "$PONYTAIL_DST" <<'PY'
import sys
import re
import shlex
import tomllib
from pathlib import Path

config_path = Path(sys.argv[1])
begin, end, snippet_path, mode = sys.argv[2], sys.argv[3], Path(sys.argv[4]), sys.argv[5]

text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
if (text.count(begin) != text.count(end) or text.count(begin) > 1
        or (begin in text and text.index(begin) > text.index(end))):
    raise SystemExit("受管理配置标记不完整或重复，保留原配置。")
tomllib.loads(text)
has_block = begin in text and end in text

if mode == "remove":
    if not has_block:
        print("managed block 不存在，无需移除")
        raise SystemExit(0)
    pre, rest = text.split(begin, 1)
    _, post = rest.split(end, 1)
    if pre.endswith("\n\n"):
        pre = pre[:-1]
    if post == "\n":
        post = ""
    merged = pre + post
    if merged and not merged.endswith("\n"):
        merged += "\n"
    config_path.write_text(merged, encoding="utf-8")
    print(f"已从 {config_path} 移除 managed block")
    raise SystemExit(0)

if has_block:
    pre, rest = text.split(begin, 1)
    block_content, post = rest.split(end, 1)
else:
    pre, block_content, post = text, "", ""

legacy = [{"event": event,
           "command": f'node "$HOME/.config/ponytail/kimi-hook.js" {event}',
           "timeout": 5} for event in ("SessionStart", "UserPromptSubmit")]
pattern = re.compile(r"(?m)^[ \t]*\[\[hooks\]\][ \t]*(?:#.*)?$")
def remove_known_hooks(part, known_hooks):
    removals = []
    tables = []
    for table in re.finditer(r"(?m)^[ \t]*\[", part):
        try:
            tomllib.loads(part[:table.start()])
        except tomllib.TOMLDecodeError:
            continue
        tables.append(table.start())
    for match in pattern.finditer(part):
        if match.start() not in tables:
            continue
        stop = next((start for start in tables if start > match.start()), len(part))
        hook = tomllib.loads(part[match.start():stop])["hooks"][0]
        if hook in known_hooks:
            removals.append((match.start(), stop))
        elif "ponytail" in hook.get("command", "").lower():
            print("保留归属不明的 Ponytail Hook，请核对重复加载来源。")
    for start, stop in reversed(removals):
        part = part[:start] + part[stop:]
    return part, len(removals)

if mode == "remove-ponytail":
    ponytail = [{"event": event,
                 "command": f'node "${{KIMI_CODE_HOME:-$HOME/.kimi-code}}/hooks/ponytail-hook.js" {event}',
                 "timeout": 5} for event in ("SessionStart", "UserPromptSubmit")]
    if not has_block:
        print("managed block 不存在，保留 Ponytail 入口与配置，请核对归属。")
        raise SystemExit(0)
    cleaned, removed = remove_known_hooks(block_content, ponytail)
    merged = pre + begin + cleaned + end + post
    remaining = tomllib.loads(merged)
    referenced = any(token.endswith("hooks/ponytail-hook.js")
                     for hook in remaining.get("hooks", [])
                     for token in shlex.split(hook["command"]))
    config_path.write_text(merged, encoding="utf-8")
    print(f"已从 {config_path} 移除 {removed} 条受管理的 Ponytail Hook，保留安全 Hook。")
    shim_path = Path(sys.argv[6])
    if shim_path.is_file():
        if referenced or not removed:
            print("保留 Ponytail 入口，余留 Hook 仍可能引用或归属未确认，请核对未知来源。")
        else:
            shim_path.unlink()
            print(f"已移除 Ponytail 入口: {shim_path}")
    raise SystemExit(0)

pre, migrated_before = remove_known_hooks(pre, legacy)
post, migrated_after = remove_known_hooks(post, legacy)
if migrated_before + migrated_after:
    print(f"已迁移 {migrated_before + migrated_after} 条已确认的旧全局 Ponytail Hook。")

snippet = snippet_path.read_text(encoding="utf-8").strip("\n")
block = f"{begin}\n{snippet}\n{end}\n"
if has_block:
    merged = pre + block + post.lstrip("\n")
    tomllib.loads(merged)
    config_path.write_text(merged, encoding="utf-8")
    print(f"已更新 {config_path} 中的 managed block")
else:
    prefix = pre if (not pre or pre.endswith("\n")) else pre + "\n"
    if prefix.strip():
        prefix += "\n"
    merged = prefix + block
    tomllib.loads(merged)
    config_path.write_text(merged, encoding="utf-8")
    print(f"已把 managed block 写入 {config_path}")
PY
}

if [ "${1:-}" = "--uninstall-ponytail" ]; then
  managed_block remove-ponytail
  echo "受管理的 Ponytail Hook 已处理，Kimi 安全 Hook 与其他配置保留。"
  exit 0
fi

if [ "${1:-}" = "--uninstall" ]; then
  managed_block remove
  if [ -f "$SHIM_DST" ]; then
    rm -f "$SHIM_DST"
    echo "已移除 shim: $SHIM_DST"
  fi
  if [ -f "$PONYTAIL_DST" ]; then
    rm -f "$PONYTAIL_DST"
    echo "已移除 Ponytail 入口: $PONYTAIL_DST"
  fi
  echo "Kimi CLI hooks 已卸载。"
  exit 0
fi

[ -f "$SNIPPET" ] || { echo "缺少配置片段: $SNIPPET" >&2; exit 1; }
[ -f "$SHIM_SRC" ] || { echo "缺少 shim 权威源: $SHIM_SRC" >&2; exit 1; }
[ -f "$PONYTAIL_SRC" ] || { echo "缺少 Ponytail 权威源: $PONYTAIL_SRC" >&2; exit 1; }

mkdir -p "$SHIM_DIR"
cp "$SHIM_SRC" "$SHIM_DST"
chmod +x "$SHIM_DST"
cp "$PONYTAIL_SRC" "$PONYTAIL_DST"
echo "已同步 shim: $SHIM_DST"

managed_block upsert

if command -v kimi >/dev/null 2>&1; then
  kimi doctor
fi

echo "Kimi CLI hooks 安装完成；新会话生效（已有会话用 /reload 重载配置）。"
