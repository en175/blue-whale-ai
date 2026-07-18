# 全栈 MVP 验收 E2E（IK1NS2）

与 `e2e/`（纯前端 Mock，UI 快速回归）**明确分离**的两套 Playwright 套件：

| 维度 | `e2e/`（Mock 回归）     | `e2e-fullstack/`（全栈验收）                                      |
| ---- | ----------------------- | ----------------------------------------------------------------- |
| 配置 | `playwright.config.ts`  | `playwright.fullstack.config.ts`                                  |
| 后端 | 无（App 内置离线 mock） | 完整 Docker Compose 全栈（Fake Provider）                         |
| 认证 | localStorage 占位 seed  | 测试号经 Gateway 换真实 JWT 后 seed                               |
| 入口 | `npm run test:e2e`      | `npm run test:e2e:fullstack`（= `scripts/run-mvp-acceptance.sh`） |
| 产物 | `test-results/`         | `test-results/fullstack/`（含失败时脱敏服务日志 `service-logs/`） |

## 运行

```bash
# 仓库根（推荐）：单命令完成 起栈 → 等健康 → 验收 → 清理
scripts/run-mvp-acceptance.sh

# 调试：结束后保留栈与数据
scripts/run-mvp-acceptance.sh --keep-stack
```

- 验收栈项目名 `bw-mvp-acceptance`（容器 `bw-acc-*`、镜像 `:acceptance`、web 3100 / gateway 8786），
  与开发者 `blue-whale-local` 栈完全隔离，可共存；结束时 `down -v` 只清理自己的资源。
- 只使用 Fake Provider、测试 ContentReview 与合成数据，不触发真实供应商调用或费用。
- 断言以 Project Snapshot（经 Web rewrite → Gateway）为产品权威，不依赖 Worker 内存或前端 Mock。

## 覆盖的验收点

`mvp-closed-loop.spec.ts` 单条串行链路：

1. 测试认证态进入 Project（空库自动建「未命名项目」）。
2. 不完整生图意图 → `creation_clarification` UserInputRequest（澄清问题出现在对话中）。
3. 自然语言回答 → 原 AgentRun 从 RuntimeCheckpoint 恢复 → `source=agent_run` 的 `generate_image` Job。
4. Fake 成功 → 唯一私有 Asset；聊天 Card 与画布 NodeItem 引用同一 Asset 身份。
5. 拖动 NodeItem → 「已保存」→ 刷新 → Snapshot 恢复 Conversation/Card/Job/Asset/NodeItem 与最后位置，无重复节点。
6. `生成一张fake:failure` → 确定性失败 → 稳定产品错误「图像生成失败」（不泄漏内部细节），失败不产生 Asset。
7. 失败 Card 重试 → 新 Job（`retry_of_job_id` 指向原 Job）→ 原 Job 保持失败 → 新 Job 成功 → 新 Asset/Card/NodeItem。
