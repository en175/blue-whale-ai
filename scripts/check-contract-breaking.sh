#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODULE_DIR="contracts/proto"
BASELINE_REF="${1:-HEAD}"

[ -d "$ROOT/$MODULE_DIR" ] || exit 0

if ! command -v buf >/dev/null 2>&1; then
  echo "  ⚠️  buf 未安装，跳过契约 breaking 检测。"
  echo "     安装：brew install buf"
  echo "     改动 contracts/proto/ 前建议先装，否则破坏性变更只会在 PR 门禁暴露。"
  exit 2
fi

cd "$ROOT" || exit 0

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
    · 删字段**必须 reserve 号与名**（要防的是字段号复用 —— 那才是真正的危险）
    · 没用了的字段**删掉**，不要留成 deprecated 死字段
    · 不能原地改类型 / 改字段号；要改就换新号（同一号码换类型，滚动发布期间会读出错误值）
    · 规则集是 WIRE，见 contracts/buf.yaml 里「为什么由 FILE 改过来」

  若契约尚未上线、确认要破坏：本次跳过，并在 PR 描述里说明理由。
EOF
  exit 1
fi

exit 0
