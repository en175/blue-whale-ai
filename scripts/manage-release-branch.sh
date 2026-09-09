#!/usr/bin/env bash
# Manage release/* branches (发布批次分支) on the main checkout.
#
#   list    — 列出远端最近 N 个 release/* 分支（默认 3），提 PR 时连同 master 一并交用户选目标。只读，无需授权。
#   create  — 从同步后的 origin/master 拉新 release 分支并推送 origin。发布人的独立动作，
#             需 --user-authorized；提 PR 时不自动新建批次。
#
# 命名（branch-naming.md「release 分支」节）：
#   release/YYYY.MM.DD            纯日期
#   release/YYYY.MM.DD_<中文描述>  日期 + 6–15 字中文描述（禁空格/下划线/连字符/斜杠）
#   同名已存在时自动追加序号 _2 / _3。
#
# 清理已合入 origin/master 的 release 分支走 scripts/cleanup-release-branch.sh（唯一清理入口，不在此重复）。
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

AUTHORIZED=0
ACTION=""
BRANCH=""
COUNT=3
SUMMARY=""
AS_JSON=0
PYTHON=()
. "$SCRIPT_ROOT/scripts/lib/python3-command.sh"

# Windows 下子进程 python 默认 GBK 输出会让中文崩溃；与 publish-review-package.sh 同因同治。
export PYTHONIOENCODING=utf-8

if select_python3_command; then
  PYTHON=("${PYTHON3_COMMAND[@]}")
fi

usage() {
  cat >&2 <<EOF
用法:
  scripts/manage-release-branch.sh list [--count N]
  scripts/manage-release-branch.sh create [--summary <6–15字中文简述>] --user-authorized [--json]

list:    fetch 后列出远端最近 N 个 release/* 分支（默认 3，按最近提交排序），提 PR 时连同
         master 一并交用户选合并目标。只读。提 PR 不自动新建批次。
create:  从同步后的 origin/master 创建 release/YYYY.MM.DD[_<中文描述>] 并推送 origin。
         发布人的独立发布动作，必须先获用户明确授权（--user-authorized）；仅在主 checkout 的本地 master 上执行。
         同名已存在（同日多批次）自动追加 _2/_3 序号。
清理已合并的 release 分支：scripts/cleanup-release-branch.sh --user-authorized <branch>
EOF
  exit 2
}

fail() { echo "❌ manage-release-branch: $*" >&2; exit 1; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --user-authorized) AUTHORIZED=1; shift ;;
    --summary) [ "$#" -ge 2 ] || fail "--summary 缺少参数。"; SUMMARY="$2"; shift 2 ;;
    --count) [ "$#" -ge 2 ] || fail "--count 缺少参数。"; COUNT="$2"; shift 2 ;;
    --json) AS_JSON=1; shift ;;
    -h|--help) usage ;;
    -*) fail "不支持的参数：$1" ;;
    *)
      if [ -z "$ACTION" ]; then ACTION="$1"
      elif [ -z "$BRANCH" ]; then BRANCH="$1"
      else fail "多余的位置参数：$1"
      fi
      shift ;;
  esac
done

case "$COUNT" in
  ''|*[!0-9]*|0) fail "--count 必须是正整数。" ;;
esac

# ROOT 用 BASH_SOURCE 而非 git rev-parse --show-toplevel：本脚本是主 checkout 脚本
# （lib/worktree-paths.sh 注释约定），运行时可能 cwd 在任意处；BASH_SOURCE 派生的 ROOT
# 稳定指向主 checkout scripts/ 的父目录，不依赖 worktree 上下文。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/worktree-paths.sh
source "$ROOT/scripts/lib/worktree-paths.sh"
WORKTREE_BASE="$(worktree_paths_resolve_base "$ROOT")"

case "$ACTION" in
  list) ;;
  create)
    [ "$AUTHORIZED" = 1 ] || fail "创建 release 分支是发布动作，缺少 --user-authorized。必须先获得用户明确授权。"
    # create 会写共享仓库引用并推送远端：仅主 checkout（worktree 形态拒绝，与 cleanup-release-branch.sh 同则）。
    case "$ROOT" in "$WORKTREE_BASE"/*) fail "请在主 checkout 执行 create，不要在任务 worktree 内：$ROOT" ;; esac
    ;;
  "") usage ;;
  *) fail "未知操作：$ACTION（支持 list / create）" ;;
esac

# ---------- list ----------
if [ "$ACTION" = "list" ]; then
  # best-effort fetch --prune：保证看到他人刚建/刚删的批次；离线时降级用本地远端跟踪引用。
  git -C "$ROOT" fetch origin --prune >/dev/null 2>&1 || true
  # 不用 mapfile / 数组展开：macOS 默认 bash 3.2 无 mapfile，且 set -u 下空数组展开会炸。
  # 用 for-each-ref 原生 --count 而非 `| head`：head 提前退出会让 for-each-ref 吃 SIGPIPE，
  # pipefail 下整个命令替换非零 → set -e 误杀脚本。
  listing="$(git -C "$ROOT" for-each-ref --count="$COUNT" --sort=-creatordate --format='%(refname:lstrip=3)' \
    'refs/remotes/origin/release/*' 2>/dev/null)"
  if [ -z "$listing" ]; then
    echo "（远端没有 release/* 分支）"
    echo "提 PR 可选目标：master（仅工程面 docs/chore 与 hotfix 直进）。"
    echo "产品批次需发布人先开批：scripts/manage-release-branch.sh create --summary <中文简述> --user-authorized"
    exit 0
  fi
  echo "最近 release 分支（按最近提交排序，供提 PR 选目标）："
  printf '%s\n' "$listing" | while IFS= read -r b; do
    headline="$(git -C "$ROOT" log -1 --oneline "origin/$b" 2>/dev/null || echo '?')"
    case "$b" in
      release/[0-9][0-9][0-9][0-9].[0-9][0-9].[0-9][0-9]*)
        printf '  %-36s %s\n' "$b" "$headline" ;;
      *)
        printf '  %-36s %s  [旧命名，勿作新 PR 目标]\n' "$b" "$headline" ;;
    esac
  done
  echo
  echo "  master  仅工程面 docs/chore 与 hotfix 直进目标（产品影响路径不得选）"
  echo
  echo "与 master 一并交用户选目标 → publish-review-package.sh --create-pr --target-branch <分支名>；"
  echo "提 PR 不自动新建批次——开批次是发布人独立动作（create 子命令）。"
  exit 0
fi

# ---------- create ----------
current="$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
[ "$current" = "master" ] || fail "create 需在主 checkout 的本地 master 上执行，当前是 ${current:-detached HEAD}。"
[ "${#PYTHON[@]}" -gt 0 ] || fail "校验 release 分支名需要可用的 Python 3。"

base="$(date +%Y.%m.%d)"
if [ -n "$SUMMARY" ]; then
  # 与任务分支简述同规：报错而非静默剥离非法字符（对齐 start-task-worktree.py normalize_summary 行为）。
  case "$SUMMARY" in
    *[[:space:]]*|*_*|*-*|*/*|*\\*) fail "描述禁止包含空格、下划线、连字符、斜杠或反斜杠：$SUMMARY" ;;
  esac
  branch="release/${base}_${SUMMARY}"
else
  branch="release/$base"
fi

git -C "$ROOT" fetch origin master
master_sha="$(git -C "$ROOT" rev-parse origin/master)"

# 同名（远端或本地）已存在 → 同日多批次自动追加 _2/_3 序号（首批无序号即第 1 批）。
candidate="$branch"
suffix=1
while git -C "$ROOT" show-ref --verify --quiet "refs/heads/$candidate" \
   || git -C "$ROOT" ls-remote --exit-code --heads origin "$candidate" >/dev/null 2>&1; do
  suffix=$((suffix + 1))
  candidate="${branch}_${suffix}"
done

# 与 pre-push 同一权威校验器：格式 / 描述长度 / 含中文（start-task-worktree.py RELEASE_RE）。
if ! err="$("${PYTHON[@]}" "$ROOT/scripts/start-task-worktree.py" --validate-branch "$candidate" 2>&1)"; then
  fail "release 分支名校验失败：${err}"
fi
git -C "$ROOT" check-ref-format --branch "$candidate" >/dev/null 2>&1 \
  || fail "生成的分支名不符合 Git ref 规则：$candidate"

git -C "$ROOT" branch "$candidate" "$master_sha"
# push 的 stdout（"set up to track" 行）转到 stderr：保持脚本 stdout 纯净，--json 输出可被机器消费。
if ! git -C "$ROOT" push -u origin "$candidate" >&2; then
  # 推送失败回滚本地引用，避免残留半状态干扰重试（重试会因本地已存在而误加序号）。
  git -C "$ROOT" update-ref -d "refs/heads/$candidate" 2>/dev/null || true
  fail "推送 $candidate 失败，已回滚本地分支引用；可重试。"
fi

if [ "$AS_JSON" = 1 ]; then
  printf '{"status":"created","branch":"%s","base":"%s"}\n' "$candidate" "$master_sha"
else
  echo "✅ 已创建 release 分支：$candidate（基于 origin/master $master_sha）"
fi
