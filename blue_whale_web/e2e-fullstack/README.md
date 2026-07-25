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

> 隔离约定（IK2BDN 引入）：串行套件共享同一验收库，每个 spec 经 `createProject` 使用**私有 Project** 并以 `/canvas?project=<id>` 进入，彼此的 Job/Asset/画布节点互不可见；页面级登录态每测试重新登录播种（App 首次挂载会旋转 refresh_token，旧种子随即失效）。

`mvp-closed-loop.spec.ts` 单条串行链路：

1. 测试认证态进入私有 Project。
2. 不完整生图意图 → `creation_clarification` UserInputRequest（澄清问题出现在对话中）。
3. 自然语言回答 → 原 AgentRun 从 RuntimeCheckpoint 恢复 → `source=agent_run` 的 `generate_image` Job。
4. Fake 成功 → 唯一私有 Asset；聊天 Card 与画布 NodeItem 引用同一 Asset 身份。
5. 拖动 NodeItem → 「已保存」→ 刷新 → Snapshot 恢复 Conversation/Card/Job/Asset/NodeItem 与最后位置，无重复节点。
6. `生成一张fake:failure` → 确定性失败 → 稳定产品错误「图像生成失败」（不泄漏内部细节），失败不产生 Asset。
7. 失败 Card 重试 → 新 Job（`retry_of_job_id` 指向原 Job）→ 原 Job 保持失败 → 新 Job 成功 → 新 Asset/Card/NodeItem。

`bottom-dock-contract.spec.ts`（IK2BCH T6.1）：运行态构建身份非 `unknown` + BottomDock 基础图片请求 payload 含五字段（`model_id`/`size`/`web_search`/`input_asset_ids`/`expected_output_count`）。

`bottom-dock-three-scenarios.spec.ts`（IK2BDN T6.3）串行套件，真实 BottomDock → 实际 GenerationJob HTTP 端点 → 持久化事实的最高层接缝：

1. 构建身份强断言：运行制品 `git_commit` == 本轮 checkout revision，非空非 `unknown`。
2. 四输出组图：UI 选模型/1:1/2K/数量 4 → payload 与持久化 Job 输入一致 → 4 槽位 succeeded 各绑定可访问 Asset → 治理事实链完整 → Provider 调用恰好 4 次。
3. 私有参考图：以场景一产物为参考 Asset，鉴权缩略图（blob:）→ payload 与 Job 输入 `input_asset_ids`/`reference_asset_ids` 只含该 Asset。
4. 联网搜索：开 → payload 与 Job 输入 `web_search=true`；关 → 二者均 false。
5. 幂等重放（同 Idempotency-Key + 同请求）返回首次接纳结果，不建第二个 Job；刷新页面恢复节点不重复、Provider 事实不变。
6. 重试（`fake:failure`）只处理失败槽位：新 Job 带 `retry_of_job_id`，原 Job 终态不改写，两侧 Provider 调用各一次。
7. 缺 `model_id` 负向回归：400 + `VALIDATION_FAILED`，jobs/reservations/provider_tasks/events 全局计数不变。

治理事实（content_reviews/cost_reservations/audit_records/generation_provider_tasks/project_events）无 HTTP 查询出口，由 `_fixtures/acceptance-db.ts` 经 `docker exec bw-acc-mysql` 只读断言，SQL 口径与后端 `BottomDockGenerationJobIT`/`LocalFakeGenerationIT` 一致。
