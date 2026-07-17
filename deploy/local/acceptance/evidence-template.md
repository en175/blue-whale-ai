# IK1NS3 受控真实图片验收证据记录

> **填写规则**：只记录标识、状态与存在性（是/否）。
> **禁止**粘贴：Token、API Key、AK/SK、签名/临时 URL、供应商原始响应、生成媒体本体。

- 验收日期时间：
- 执行人：
- 运行环境：本地 Docker Compose（非生产）
- 代码版本（`git rev-parse HEAD`）：
- 固定合成提示词：`生成一张白底扁平风格的蓝色鲸鱼图标，无文字`

## 非敏感配置模式核对（只记存在性，不记值）

| 配置项 | 已设置（是/否） | 备注 |
|---|---|---|
| `GENERATION_MODE=openai-tos` | | |
| `GENERATION_ACCEPTANCE_ALLOWED=true` | | |
| `OPENAI_API_KEY` 已注入 | | 不记值 |
| `OPENAI_BASE_URL` | | 只记主机名 |
| `GENERATION_TOS_ACCESS_KEY` / `GENERATION_TOS_SECRET_KEY` 已注入 | | 不记值 |
| `GENERATION_TOS_REGION` / `GENERATION_TOS_ENDPOINT` | | 只记区域与主机名 |
| `GENERATION_TOS_BUCKET`（测试 Bucket） | | 只记名称 |
| `GENERATION_TOS_PREFIX` | | |
| `SEEDANCE_CALLBACK_BASE_URL`（占位） | | 不触发视频调用 |

## 产品事实标识

| 事实 | 标识 |
|---|---|
| User（内部测试账号） | |
| Project（测试项目） | |
| AgentRun | |
| GenerationJob | |
| ContentReview | |
| Asset | |

## 规范化终态核查

| 核查项 | 预期 | 实际 | 通过 |
|---|---|---|---|
| GenerationJob | `image` / `agent_run` / `succeeded`，单 Job | | ☐ |
| GenerationJobOutput | 1 行 `succeeded`，`asset_id` 非空 | | ☐ |
| Asset | 恰好 1 个不可变图片 Asset | | ☐ |
| ContentReview | `decided` + `pass`，`evidence_ref=non-production-acceptance-review` | | ☐ |
| AuditRecord | 预留创建/准入/调用结果/审核决定/成本结算五类事实齐全 | | ☐ |
| CostReservation | `SETTLED` | | ☐ |
| Project 事件 | `asset.created` + `generation_job.output_attached` | | ☐ |
| 快照/Card/NodeItem | 同一 `asset_id` | | ☐ |
| 私有访问边界 | owner 200 / 跨 User 404 / 未认证 4xx | | ☐ |
| 供应商调用次数（控制台人工核查） | 恰好 1 次 | | ☐ |

## 核查结论

- [ ] 通过
- [ ] 不通过（说明：）

签名：
