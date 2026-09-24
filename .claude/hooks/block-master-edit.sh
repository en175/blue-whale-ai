#!/usr/bin/env bash
# Claude Code PreToolUse hook — 拦截 AI 在 master 和 release 分支直接 Edit/Write 文件
#
# 拦截对象：
#   - Edit 工具（agent 编辑文件时触发）
#   - Write 工具（agent 创建文件时触发）
#   当目标文件所属工作树不是任务分支时拦截。
#
# 放行：
#   - 目标文件在带有效发布线元数据的独立任务 worktree
#   - 目标文件不在任何 git 工作树内（仓库外 dotfile，如 ~/.codex/config.toml）
#   - master 分支但目标是已被 Git 忽略的根 CLAUDE.local.md 或 .codex/config.toml
#   - 非 Edit/Write 工具
#
# 为什么拦：Agent 不得在本地 master 或活动 release 直接修改文件。
#   所有改动必须在工单分支 worktree 中完成，走分支→PR→合并流程。
#   决策见 docs/adr/0115-local-release-code-baseline.md
#
# 分支判定按 file_path 所属工作树（git -C），不看 cwd：
#   主 checkout session（cwd=master）编辑 worktree 工单分支文件时，
#   按 file_path 解析得到工单分支与任务元数据 → 放行，不依赖固定目录布局。
#
# 审计闭环（IK10CW）：对仓库内 Edit/Write 的判定（阻断或放行）追加一条单行
#   结构化审计记录（时间/hook/工具/file_path/分支/session_id/tool_use_id/exit_code/reason）。
#   审计只记判定元数据，不记文件内容/命令/凭证；成功或失败均不改变原 exit code、
#   stdout 契约或既有阻断信息（降级时仅在 stderr 留简短提示）。
#   非 Edit/Write 工具与仓库外文件操作不审计（IK10CW out of scope）。
#
# 退出码 2 = 阻断 Claude 执行该工具调用。

INPUT=$(cat)
HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
PRETOOL="$HOOK_DIR/lib/pretool.py"
AUDIT="$HOOK_DIR/lib/hook_audit.py"
HOOK_NAME="$(basename "$0")"
TOOL_NAME=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value tool_name 2>/dev/null || true)

# audit <exit_code> <reason>：判定完成后、返回前调用；失败不改变 exit code。
# stdin 复用原 INPUT，让 helper 读 tool_name/tool_use_id/session_id/file_path。
# project-dir 用 file_path 所属工作树的 TOPLEVEL（已解析），不用会话级
# CLAUDE_PROJECT_DIR——否则主 checkout 会话编辑 worktree 临时仓库文件时，
# 审计事件会错误落到真实仓库的 common dir，污染真实审计流。
# stdout 重定向到 /dev/null（守护 stdout 空契约）；stderr 透传——降级时 helper
# 在 stderr 留「hook-audit: degraded (...)」简短提示，符合 IK10CW 降级语义。
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

# 只处理 Edit / Write 工具
case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

# 取 Edit/Write 目标文件路径
FILE_PATH=$(printf '%s' "$INPUT" | python3 "$PRETOOL" value file_path 2>/dev/null || true)

# 按目标文件所属工作树解析分支与 toplevel（不看 cwd，去 worktree 路径布局假设）
#   dirname("")="."：file_path 缺失时退化为 cwd 分支判定（保留旧行为）
FILE_DIR="$(dirname "$FILE_PATH")"
BRANCH=$(git -C "$FILE_DIR" symbolic-ref --short HEAD 2>/dev/null || echo "")
TOPLEVEL=$(git -C "$FILE_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")

# file_path 父目录尚不存在（如 Write 全新子目录文件）→ git -C 失败、BRANCH/TOPLEVEL 空。
# 向上遍历到最近存在的祖先目录重试，否则误判「仓库外」放行，master 内新文件漏拦。
# 遍历有界（上限 64 层）且对 dirname 不收敛的盘符根（E:、C: 等，MSYS 下 dirname 自引用）判死：
# 命中即 fail-closed 按 master 拦截，绝不落到下方「仓库外」放行（IK10D1 codex 适配 + Windows 盘符
# 伪路径组合会制造 E:\... 这类不可解析路径，无上限会死循环）。POSIX 上路径总能向上收敛，行为不变。
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
    # 不可解析路径（盘符根/自引用）→ 无法定位工作树，fail-closed 按 master 硬拦。
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

# 目标文件不在任何 git 工作树内（仓库外）→ 放行
if [ -z "$TOPLEVEL" ]; then
  exit 0
fi

# 任务名分支也必须属于独立 worktree，且元数据能与当前分支和起点核对。
# 只按分支前缀放行会允许在主 checkout 手工切出 chore/* 后绕过开工入口。
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

# master 上已忽略的两处本地个人配置是唯一写入例外。
#   实化 FILE_PATH 目录（解 macOS /var→/private/var 等 symlink）再剥离 TOPLEVEL 前缀；
#   剥离失败（文件不在本工作树根下）→ 不命中，落入下方硬拦（fail closed）。
if REAL_DIR="$(cd "$FILE_DIR" 2>/dev/null && pwd -P)" && [ -n "$REAL_DIR" ]; then
  # TOPLEVEL（git rev-parse --show-toplevel）在 Windows 下是盘符形式（C:/...），
  # 而 REAL_DIR 经 cd+pwd -P 是 POSIX 形式（/c/... 或 /tmp/...）——直接前缀剥离会
  # 失败导致文档白名单/本地配置误拦。把 TOPLEVEL 也归一化到同一物理形式再剥离；
  # 归一化失败时沿用原值（保持 fail-closed）。POSIX 上 pwd -P 为 no-op，行为不变。
  TOPLEVEL_P="$(cd "$TOPLEVEL" 2>/dev/null && pwd -P)" || TOPLEVEL_P="$TOPLEVEL"
  REL_PATH="${REAL_DIR%/}/$(basename "$FILE_PATH")"
  REL_PATH="${REL_PATH#$TOPLEVEL_P/}"

  # 本地个人配置只有同时满足「精确路径 + Git 已忽略」才放行。
  # 路径白名单防止扩大 master 写面；check-ignore 防止配置意外进入团队仓库。
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

# 保护分支或 detached HEAD + 仓库内 Edit/Write → 硬拦并审计
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
