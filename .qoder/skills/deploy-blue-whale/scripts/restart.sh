#!/usr/bin/env bash
# 远程重启：逐个判断同名容器 → 在跑则 docker rm -f → docker compose up -d 重建。
# 用法: restart.sh [gateway|user|agent ...]   默认全部
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
ensure_key

SERVICES=("$@")
if [ ${#SERVICES[@]} -eq 0 ]; then SERVICES=(gateway user agent web); fi
for s in "${SERVICES[@]}"; do check_svc "$s"; done

for svc in "${SERVICES[@]}"; do
  name="blue-whale-$svc"
  running=$("${SSH[@]}" "docker ps -a --format '{{.Names}}' | grep -qx '$name' && echo yes || echo no" 2>/dev/null || echo no)
  if [ "$running" = yes ]; then
    echo "▶ $name 在跑 → 关闭删除重建"
    "${SSH[@]}" "docker rm -f $name" >/dev/null 2>&1 || true
  else
    echo "▶ $name 不存在 → 新建"
  fi
  "${SSH[@]}" "cd $REMOTE_DIR && docker compose up -d blue-whale-$svc"
  if [ "$svc" = web ]; then
    echo "▶ 验证前端 http://localhost:3000"
    "${SSH[@]}" "for i in 1 2 3 4 5; do curl -fsS http://localhost:3000 >/dev/null && exit 0; sleep 2; done; exit 1" \
      || { echo "  ✗ 前端验证失败，看日志：" >&2; "${SSH[@]}" "docker logs --tail 30 blue-whale-web" >&2 || true; exit 1; }
    echo "  ✓ 前端 200"
  fi
done

echo ""
echo "▶ 容器状态："
"${SSH[@]}" "cd $REMOTE_DIR && docker compose ps"
"${SSH[@]}" "docker image prune -f" >/dev/null 2>&1 || true
echo "✓ restart 完成"
