#!/bin/sh
# Python Agent Worker 循环包装：不断推进 Fake AgentRun。
#
# Python worker 本身是单次 run_once() 后退出的 CLI（见 __main__.py）。
# 本脚本不改 Python 业务代码，只在容器内做 while true; run_once; sleep 1。
#
# 环境变量：
#   BLUE_WHALE_AGENT_BASE_URL  Java Product API 地址（容器内 http://blue-whale-agent:8082）
#   WORKER_ADAPTER             编排引擎（fake / pydantic-ai），本地默认 fake
#   WORKER_ID                  Worker 标识，默认 local-fake-worker
#   WORKER_POLL_INTERVAL_SEC   轮询间隔（秒），默认 1

set -eu

BASE_URL="${BLUE_WHALE_AGENT_BASE_URL:-http://blue-whale-agent:8082}"
ADAPTER="${WORKER_ADAPTER:-fake}"
WORKER_ID="${WORKER_ID:-local-fake-worker}"
INTERVAL="${WORKER_POLL_INTERVAL_SEC:-1}"

echo "[worker-loop] base_url=${BASE_URL} adapter=${ADAPTER} worker_id=${WORKER_ID} interval=${INTERVAL}s"

# 等 Java 端就绪：claim 失败是正常的（说明没有 pending AgentRun），不是错误
while true; do
    if python -m blue_whale_agent_worker \
        --adapter "${ADAPTER}" \
        --base-url "${BASE_URL}" \
        --worker-id "${WORKER_ID}" 2>&1; then
        :
    else
        # claim/commit 失败（无待处理 Run、网络抖动、Java 重启）只记录，不退出
        echo "[worker-loop] run_once 失败，${INTERVAL}s 后重试"
    fi
    sleep "${INTERVAL}"
done
