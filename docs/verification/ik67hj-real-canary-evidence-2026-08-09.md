# IK67HJ（T18）真实层验收证据：真实图片/视频 canary + Snapshot/SSE 恢复

> **状态：历史局部证据，不构成 T18 最终验收。** 本次只完成真实图片、视频与恢复；真实 Agent canary 未执行，且运行服务 `/build-info` 为 `unknown`，未证明服务制品与仓库 HEAD 是同一候选。

- 日期：2026-08-09
- 历史运行 checkout：commit `b5641c5ed97bbd90b3d66547f43d9044bdeb8353`（只能证明脚本 checkout；不能证明实际 web/worker 制品身份）
- 执行人：AI Agent（真实计费已获人工知情同意，脚本含 `BW_ALLOW_BILLED_CANARY=1` 知情闸）
- 目标环境：本地自足栈——dev-stack（bw-ts-dev：mysql/redis/new-api）+ worktree dev 进程（web:3000、generation-worker:4002）；真实上游=火山引擎 ark（new-api 渠道 9101 图 / 9102 视）；对象存储=真实 TOS bucket `bluewhale-assets`（tos-cn-beijing）

## 安全边界

- 仅调用本机 HTTP 接口与本地 docker；未连接测试站/远程环境。
- 真实 provider 凭用本机既有配置（new-api 渠道 key 引用自本地 `.env` 的 `VOLC_ARK_API_KEY`，未写入本文档；canary 用户凭证存 `~/.cache/blue-whale-real-canary/credentials.json` 0600）。
- 真实计费声明：图片 1 次（seedream 1K 1:1）+ 视频 1 次（seedance 720p 5s 16:9），new-api quota 消耗 108901。
- canary 在本地 dev 数据库产生验收数据（用户 `t18-0809155859`、项目 `T18-REAL-CANARY-20260809155859` id=6、job 7/8、asset 5/6）；诊断期探测用户与早前尝试运行的残留用户已清理。

## 脱敏结果

### 历史图片/视频子运行（`scripts/run-real-canary.mjs run`，17/17 PASS）

```text
PASS  前置检查 web /build-info：git_commit=unknown
PASS  前置检查 new-api /api/status：success=true
PASS  候选锚定：repo HEAD=b5641c5ed97bbd90b3d66547f43d9044bdeb8353 dirty=false
PASS  注册 canary 用户：username=t18-0809155859 user_id=8
PASS  创建项目：name=T18-REAL-CANARY-20260809155859 id=6
PASS  创建图片 canary 任务：job_id=7 model=doubao-seedream-4-0-250828
PASS  创建视频 canary 任务：job_id=8 model=doubao-seedance-2-0-260128
PASS  SSE 断点记录：断点前 2 条事件，断点游标 344751407666040832
PASS  图片 canary 终态：job_id=7 status=succeeded progress=100
PASS  视频 canary 终态：job_id=8 status=succeeded progress=100
PASS  quota 差值：消耗 108901
PASS  图片对象存储断言：asset_id=5 slot_id=7 url=https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/8/image/330ba276524a431c8649690ace5f3a2f.jpg
PASS  视频对象存储断言：asset_id=6 slot_id=8 url=https://bluewhale-assets.tos-cn-beijing.volces.com/generated/8/video/4d7362cb64be4667add3149df2418573.mp4
PASS  Canvas 放置：节点 generation-output:7 placed（assetId=5）
PASS  Canvas 放置：节点 generation-output:8 placed（assetId=6）
PASS  SSE 断线续传：断点前 2 条 + 续传 6 条 == 全量 8 条，无缺口无重复
PASS  状态文件：已写入（凭证 0600 另存）
VERDICT: PASS
```

上面的 PASS 只表示该次图片/视频子运行内部断言通过，不表示 T18 总体验收通过。

### 服务重启恢复验证（web + generation-worker 全停重启后 `verify-recovery`，5/5 PASS）

```text
PASS  候选版本对照：run 时 HEAD=b5641c5ed97bbd90b3d66547f43d9044bdeb8353（dirty=false），
      当前 HEAD=b5641c5ed97bbd90b3d66547f43d9044bdeb8353（dirty=false）
PASS  恢复验证重新登录：username=t18-0809155859
PASS  恢复后事实摘要比对：与 run 时 digest 深度一致
      （messages=0 plans=0 receipts=0 sceneCards=0 records=0 jobs=2 assets=2
        canvasNodeIds=2 runs=0 highWatermark=344752477695905792）
VERDICT: PASS
```

### 真实 Agent canary：产品缺口，未通过

产品代码当前仅支持 fake runtime，真实 Agent canary 无法执行（三道 fake 硬闸）：

- `apps/agent-worker/src/index.ts:38-40` — `AGENT_RUNTIME_MODE` 非 `fake` 直接 throw
- `packages/agent-runtime/src/runtime-manifest.ts:16` — `MODEL_REGISTRY` 仅含 `fake:deterministic-v1:fake-v1`
- RunPin 校验要求 manifest provider 命中注册表（即 fake）

按 Agent Brief「不修改被验收的产品代码」，该缺口已另开功能工单跟踪：**IK7EU4「实现真实 Agent provider 接入（agent-runtime 真实模型运行时）」**。

## 结论

- 历史运行观察到：真实图片、视频、SSE 续传及服务重启恢复各自通过。
- **最终结论：INCOMPLETE。** 真实 Agent canary 缺失，且运行服务候选身份未锚定。
- IK7EU4 真实 Agent provider 已合入主线，但本历史运行未包含该实现；须在包含 IK7EU4 的同一干净 commit 上一次性重跑 Agent、图片、视频及恢复验证。
- 本票证据仍不等同于 User-uploaded Asset ContentReview 生产批准。
