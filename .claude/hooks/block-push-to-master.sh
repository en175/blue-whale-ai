#!/usr/bin/env bash

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
AUDIT="$HOOK_DIR/lib/hook_audit.py"
HOOK_NAME="$(basename "$0")"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
COMMAND=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value command 2>/dev/null || true)

audit() {
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$PROJECT_DIR" \
    --hook "$HOOK_NAME" \
    --operation "$1" \
    --exit-code "$2" \
    --reason "$3" >/dev/null || true
}

if [ -z "$COMMAND" ]; then
  audit "bash-other" 0 "allowed-policy"
  exit 0
fi

if ! printf '%s' "$COMMAND" | python3 "$PRETOOL" has-git-push; then
  audit "bash-other" 0 "allowed-policy"
  exit 0
fi

target_ref=$(printf '%s' "$COMMAND" | python3 "$PRETOOL" protected-push-target 2>/dev/null || true)

case "$target_ref" in
  master|main)
    audit "git-push-protected" 2 "blocked-policy"
    cat >&2 <<EOF
BLOCKED: 直推 ${target_ref} 被拦截。
  命令: $COMMAND

本项目禁止 AI 直接 push 到 master/main（最高红线）。
- 所有进 master 的改动统一走：开分支 → 推分支 → Gitee 建 PR → 服务端合并
- 用户授权合并也走流程（分支→PR→合并），不绕过 PR
- hotfix/* 同样走分支→PR，无特权
- 详见 CLAUDE.md「Gitee 工作流」与 docs/agents/commit-and-review.md
EOF
    exit 2
    ;;
esac

audit "git-push-unprotected" 0 "allowed-policy"
exit 0
