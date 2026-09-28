#!/usr/bin/env bash
# 契约 breaking change 检测 —— 破坏性契约变更是**不可逆的**：
# 字段号复用会让新旧两端读到的数据静默错位，且线上无法回滚。
#
# 用法：
#   scripts/check-contract-breaking.sh [基线ref]
#
#   pre-commit：不带参数 → 对照 HEAD，拦「本地这次改动破坏了兼容性」
#   PR 门禁：  scripts/check-contract-breaking.sh release/2026.09.29
#
# 退出码：
#   0  通过
#   1  存在破坏性变更
#   2  环境缺失（buf 未装）—— **软提醒，不拦提交**（与 pre-commit 里 py_compile 的处理一致）
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="contracts/proto"
BASELINE_REF="${1:-HEAD}"

# 没有契约目录 → 与本次改动无关，放行
[ -d "$ROOT/$MODULE_DIR" ] || exit 0

# buf 未安装 → 软提醒，不拦提交
if ! command -v buf >/dev/null 2>&1; then
  echo "  ⚠️  buf 未安装，跳过契约 breaking 检测。"
  echo "     安装：brew install buf"
  echo "     改动 contracts/proto/ 前建议先装，否则破坏性变更只会在 PR 门禁暴露。"
  exit 2
fi

# ⚠️ 必须从仓库根跑：`.git#ref=` 是相对**当前目录**解析的，
#    在 contracts/ 下跑会找不到 .git；用 subdir= 指定模块在仓库内的位置。
cd "$ROOT" || exit 0

# 基线尚无契约目录（且 ref 有效）→ 契约首次引入，无「兼容性」可言，放行。
# 不做这步会得到 buf 的 `Module ... had no .proto files` 假失败。
if git rev-parse --verify --quiet "$BASELINE_REF^{commit}" >/dev/null 2>&1 \
   && ! git cat-file -e "${BASELINE_REF}:${MODULE_DIR}" 2>/dev/null; then
  echo "  ℹ️  基线 ${BASELINE_REF} 尚无 ${MODULE_DIR} —— 契约首次引入，跳过 breaking 检测。"
  exit 0
fi

if ! out=$(buf breaking "$MODULE_DIR" --against ".git#ref=${BASELINE_REF},subdir=${MODULE_DIR}" 2>&1); then
  echo "  ❌ 契约存在破坏性变更（对照 ${BASELINE_REF}）："
  echo "$out" | sed 's/^/     /'
  cat <<'EOF'

  规则（contracts/README.md）：
    · 字段只加不删
    · 删字段用 reserved（防字段号复用）
    · 改类型 / 改字段号 = 破坏性，须走 ADR + 两端同步升级

  若契约尚未上线、确认要破坏：本次跳过，并在 PR 描述里说明理由。
EOF
  exit 1
fi

exit 0
