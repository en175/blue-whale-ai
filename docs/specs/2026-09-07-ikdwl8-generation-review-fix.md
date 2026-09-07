# IKDWL8 生成草稿审查修复契约

父需求 IKDMQM；本次仅修复取消保护、失效视频引用和取消验收链路。

1. 取消 API 成功仅表示登记意图。权威任务仍 queued/processing 或查询失败时，卡片保持生成中、禁止再次提交，继续轮询；刷新恢复同一任务。只有 cancelled 才恢复草稿，succeeded/failed 按实际终态回填。删除沿用同一保护。
2. 视频普通参考、首帧或尾帧源卡变为草稿、生成中或失败时，保留输入关系，在 Dock 显示来源及原因并禁止发送。用户恢复来源或明确移除引用后才能提交；移除引用不删除素材卡。
3. 图片和音频 Worker 认领已登记取消的任务后，在派发供应商前通过现有带围栏的取消事务收敛到 cancelled，释放预留。复用历史命名 cancelVideoBeforeDispatch 的通用事务，保留原接口避免影响视频调用方。在途同步供应商请求不伪造取消完成，等待真实成功或失败。
4. 验收使用真实浏览器、真实 Nest 控制器/服务、隔离 MySQL、真实 Worker 编排与仓储。仅外部供应商端口控制结果和时序；禁止直接写任务、素材或输出槽终态。测试调度器按 jobId 调用生产 Worker，不验证 MQ 消费进程部署。隔离 Redis 不连接开发环境队列。

既有成功作品再次编辑规则沿用 2026-09-07-canvas-node-editing-draft-spec.md：原卡编辑、原卡重新生成。

## 修复验收记录

2026-09-07：三类媒体排队取消、图片在途取消后成功/失败，以及真实浏览器完整取消/删除竞态流程，共 8 个集成用例通过。测试中不直接写任务、素材、输出槽终态。浏览器断言包含生成中保存后刷新、参数与连线恢复、文本附件实际传到供应商、作品保留与失败原因展示。

重跑前准备隔离 MySQL 数据库（应用当前 Prisma schema）与专用 Redis，然后从仓库根目录执行：

```sh
IKDMQW_DATABASE_URL="$TEST_DATABASE_URL" IKDMQW_BROWSER=1 VIDEO_QUEUE_DRIVER=bullmq REDIS_HOST=127.0.0.1 REDIS_PORT="$TEST_REDIS_PORT" pnpm exec vitest run backend/apps/blue-whale/src/api/canvases/generation-cancel.integration.test.ts
```

覆盖边界：视频、音频在此文件覆盖排队取消；在途供应商成功/失败竞态以图片链路验证。人工交互验收与整个父需求的完整媒体生成矩阵验收不由本记录替代。
