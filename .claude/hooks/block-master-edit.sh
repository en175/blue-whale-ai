#!/usr/bin/env bash

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
AUDIT="$HOOK_DIR/lib/hook_audit.py"
HOOK_NAME="$(basename "$0")"
TOOL_NAME=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value tool_name 2>/dev/null || true)

audit() {
  printf '%s' "$INPUT" | python3 "$AUDIT" \
    --project-dir "$TOPLEVEL" \
    --hook "$HOOK_NAME" \
    --branch "$BRANCH" \
    --include-file-context \
    --operation "file-write" \
    --exit-code "$1" \
    --reason "$2" >/dev/null || true
}

case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value file_path 2>/dev/null || true)

FILE_DIR="$(dirname "$FILE_PATH")"
BRANCH=$(git -C "$FILE_DIR" symbolic-ref --short HEAD 2>/dev/null || echo "")
TOPLEVEL=$(git -C "$FILE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")

if [ -z "$BRANCH" ] && [ -z "$TOPLEVEL" ] && [ -n "$FILE_DIR" ] && [ "$FILE_DIR" != "/" ]; then
  ancestor="$FILE_DIR"
  steps=0
  while [ "$ancestor" != "/" ] && [ ! -d "$ancestor" ] && [ "$steps" -lt 64 ]; do
    next="$(dirname "$ancestor")"
    if [ "$next" = "$ancestor" ]; then
      ancestor=""
      break
    fi
    ancestor="$next"
    steps=$((steps + 1))
  done
  if [ -z "$ancestor" ]; then
    audit 2 "blocked-master"
    cat >&2 <<EOF
BLOCKED: 禁止在 master 分支直接 Edit/Write 文件。
  工具: $TOOL_NAME（无法解析目标工作树路径: $FILE_DIR）

Agent 不得在本地 master 直接修改文件（最高红线）。
- 请使用唯一入口创建 task worktree：scripts/start-task-worktree.sh --type fix --issue IK094T --summary 修复工作树写入护栏
- 在 worktree 的工单分支上完成开发后，走 PR 流程合并
- 详见 CLAUDE.md「Task Worktree」与 docs/agents/worktree-workflow.md
EOF
    exit 2
  fi
  if [ "$ancestor" != "/" ] && [ -d "$ancestor" ] && [ "$ancestor" != "$FILE_DIR" ]; then
    BRANCH=$(git -C "$ancestor" symbolic-ref --short HEAD 2>/dev/null || echo "")
    TOPLEVEL=$(git -C "$ancestor" rev-parse --show-toplevel 2>/dev/null || echo "")
  fi
fi

if [ -z "$TOPLEVEL" ]; then
  exit 0
fi

case "$BRANCH" in
  feature/*|fix/*|hotfix/*|docs/*|chore/*)
    GIT_DIR="$(git -C "$TOPLEVEL" rev-parse --absolute-git-dir 2>/dev/null || true)"
    COMMON_DIR="$(git -C "$TOPLEVEL" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [ -n "$GIT_DIR" ] && [ -n "$COMMON_DIR" ] && [ "$GIT_DIR" != "$COMMON_DIR" ] \
      && python3 "$TOPLEVEL/scripts/lib/task_metadata.py" read --worktree "$TOPLEVEL" --field task_branch >/dev/null 2>&1; then
      audit 0 "allowed-non-master"
      exit 0
    fi
    audit 2 "blocked-unmanaged-task"
    cat >&2 <<EOF
BLOCKED: ${BRANCH} 缺少可核对的独立任务 worktree 或发布线起点元数据。

Agent 须从活动发布线通过 scripts/start-task-worktree.sh 创建任务区；旧任务区须在授权后显式修复 task_metadata.py repair。
EOF
    exit 2
    ;;
esac

if REAL_DIR="$(cd "$FILE_DIR" 2>/dev/null && pwd -P)" && [ -n "$REAL_DIR" ]; then
  TOPLEVEL_P="$(cd "$TOPLEVEL" 2>/dev/null && pwd -P)" || TOPLEVEL_P="$TOPLEVEL"
  REL_PATH="${REAL_DIR%/}/$(basename "$FILE_PATH")"
  REL_PATH="${REL_PATH#$TOPLEVEL_P/}"

  if [ "$BRANCH" = "master" ]; then
    case "$REL_PATH" in
      CLAUDE.local.md|.codex/config.toml)
        if git -C "$TOPLEVEL" check-ignore -q -- "$REL_PATH" 2>/dev/null; then
          audit 0 "allowed-local-personal-config"
          exit 0
        fi
        ;;
    esac
  fi
fi

if [ "$BRANCH" = "master" ]; then
  audit 2 "blocked-master"
else
  audit 2 "blocked-protected-branch"
fi
cat >&2 <<EOF
BLOCKED: 禁止在 ${BRANCH:-detached HEAD} 直接 Edit/Write 文件。
  工具: $TOOL_NAME

Agent 须从活动发布线通过唯一入口创建任务 worktree 后写入。
- 请使用唯一入口创建 task worktree：scripts/start-task-worktree.sh --type fix --issue IK094T --summary 修复工作树写入护栏
- 在 worktree 的工单分支上完成开发后，走 PR 流程合并
- 详见 CLAUDE.md「Task Worktree」与 docs/agents/worktree-workflow.md
EOF
exit 2
