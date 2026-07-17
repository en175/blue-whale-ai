# 受控真实图片验收 Runbook（IK1NS3）

一次**受控、单次付费**的真实图片供应商调用，验证真实 Provider 复用与 Fake 相同的
GenerationJob、CostReservation、ContentReview、AuditRecord 与私有 Asset 产品链路。
仅限**非生产环境**，由具备权限的验收人员**人工执行**；Agent 不接触凭据、不代为执行。

## 边界（先读）

- 默认 Docker Compose 与普通 CI 始终使用 Fake Provider，本流程不影响它们。
- 编排引擎保持 `fake`（无 LLM 费用）；唯一付费调用是**一次**真实图片生成。
- 真实调用复用产品控制面：有效 CostReservation + 准入审计之后才会调用供应商；
  结果先私有落盘，经非生产验收证据源形成规范化 ContentReview，只有
  `decided + pass` 才创建不可变私有 Asset。
- 非生产验收证据只在 `mode=openai-tos` + 显式 `GENERATION_ACCEPTANCE_ALLOWED=true`
  且非生产 profile 下装配；生产 profile 拒绝该组合启动，真实生产模式继续 fail closed。
- 缺失/无效配置在启动期即失败（fail closed），不回退到 Fake 或未声明的 Provider。

## 前置检查

1. **代码版本**：在仓库根执行 `git rev-parse HEAD`，记录到证据模板。
2. **非生产确认**：本地 Docker Compose 环境；TOS 使用**测试 Bucket**（非生产）；
   登录使用内部测试手机号 `15079999999`。
3. **凭据来源**：真实凭据（OPENAI_API_KEY、TOS AK/SK）只写入 `deploy/local/.env`
   （已在 `.gitignore`）。执行 `git status --porcelain deploy/local/` 确认无凭据入库。
4. **端口空闲**：3000 / 8686 / 8081 / 8082 / 3306 / 6379 / 8848。

## 配置（一次性）

1. 若尚无 `.env`：`cp deploy/local/.env.example deploy/local/.env`
2. 编辑 `deploy/local/.env`，取消注释并填写受控验收区块：

   ```env
   GENERATION_MODE=openai-tos
   GENERATION_ACCEPTANCE_ALLOWED=true
   OPENAI_API_KEY=<真实图片供应商 Key，仅本地>
   OPENAI_BASE_URL=<供应商服务根地址，默认 https://api.openai.com>
   GENERATION_TOS_ACCESS_KEY=<测试 Bucket AK>
   GENERATION_TOS_SECRET_KEY=<测试 Bucket SK>
   GENERATION_TOS_REGION=<区域，如 cn-beijing>
   GENERATION_TOS_ENDPOINT=<TOS endpoint 主机名>
   GENERATION_TOS_BUCKET=<测试 Bucket 名>
   GENERATION_TOS_PREFIX=generation-acceptance
   SEEDANCE_CALLBACK_BASE_URL=https://callback.invalid/acceptance-placeholder
   ```

   > `SEEDANCE_CALLBACK_BASE_URL` 仅为通过启动期配置校验的占位；本验收不触发视频调用。
   > 模型固定 `gpt-image-2`（启动校验强制）。

## 执行（单次调用）

1. `scripts/local-mvp.sh up`
2. `scripts/local-mvp.sh health`（8 服务全健康才继续）
3. 浏览器打开 http://localhost:3000 ，手机号 `15079999999` + 任意 6 位验证码登录。
4. 创建测试 Project（名称建议含「验收」）。
5. 在 AgentChatPanel 发送固定合成提示词（一字不差，只发一次）：

   ```
   生成一张白底扁平风格的蓝色鲸鱼图标，无文字
   ```

6. 观察 Card 从 `generating` 推进到 `normal` 并显示图片。**不要**重发消息、
   不要刷新重试——重试可能产生第二次付费调用。
7. 按下节核查产品事实（只读标识与状态字段）。

## 预期产品事实（核查清单）

将 `<JOB_ID>` 替换为实际 GenerationJob id（可从 Agent Service 日志或
`generation_jobs` 表最近一行取得）：

```bash
docker exec -i bw-mysql mysql -uroot -pblue_whale blue_whale -e "
SELECT id, type, source, status FROM generation_jobs ORDER BY id DESC LIMIT 1;
SELECT generation_job_id, slot_index, status, asset_id FROM generation_job_outputs WHERE generation_job_id=<JOB_ID>;
SELECT id, type, source, status, content_sha256 FROM assets WHERE generation_job_id=<JOB_ID>;
SELECT review_state, decision, failure_code, policy_version, evidence_ref FROM content_reviews WHERE subject_id='generation-job:<JOB_ID>:slot:0';
SELECT action, decision, reason_code FROM audit_records WHERE correlation_id='generation-job:<JOB_ID>' ORDER BY id;
SELECT status FROM cost_reservations WHERE generation_job_id=<JOB_ID>;
SELECT event_type FROM project_events WHERE project_id=(SELECT project_id FROM generation_jobs WHERE id=<JOB_ID>) ORDER BY cursor;"
```

| 核查项 | 预期 |
|---|---|
| generation_jobs | `type=image`、`source=agent_run`、`status=succeeded`，单 Job |
| generation_job_outputs | 1 行，`status=succeeded`，`asset_id` 非空 |
| assets | 恰好 1 行不可变图片 Asset，`content_sha256` 为 64 位十六进制 |
| content_reviews | `review_state=decided`、`decision=pass`、`failure_code=NULL`、`evidence_ref=non-production-acceptance-review` |
| audit_records | 含 `cost_reservation.create/allowed`、`cost_reservation.provider_admission/allowed/RESERVATION_ACTIVE`、`generation_provider.call_outcome/allowed/SUCCESS`、`content_review.decision/allowed/CONTENT_REVIEW_PASS`、`cost_reservation.settle/allowed/PROVIDER_COST_PROVEN` |
| cost_reservations | `status=SETTLED` |
| project_events | 含 `asset.created` 与 `generation_job.output_attached` |
| UI/快照 | Card、NodeItem、Snapshot 引用同一 `asset_id`；跨账号访问该 Asset 不可见 |
| 供应商控制台（人工核查） | 图片生成调用次数**恰好 1 次**（只看计数，不复制任何响应内容） |

## 失败停止条件（命中任一即停止，不重复付费调用）

- 服务启动失败：配置校验拒绝（缺失/无效配置 fail closed）。修正 `.env` 后才可重启；
  此阶段尚未产生供应商调用。
- Job 终态 `failed`，`error.code` 为 `provider_failed` / `content_review_unavailable` /
  `content_rejected` / `storage_failed` / `outcome_unknown`：记录标识与终态，停止。
- 供应商控制台显示调用次数 >1：停止并按缺陷上报。
- 任何日志/错误中出现凭据明文：立即停止，吊销该凭据并上报。

## 验收后清理

1. `scripts/local-mvp.sh down`
2. 删除测试 Bucket 中 `generation-acceptance/` 前缀下的验收对象。
3. 吊销或轮换本次使用的临时凭据。
4. 还原 `.env`（重新注释受控验收区块或删除凭据行），
   执行 `git status --porcelain deploy/local/` 确认无凭据入库。

## 脱敏规则（必须遵守）

- **禁止**记录或复制：Token、API Key、AK/SK、签名/临时 URL、供应商原始响应、
  生成媒体本体。
- **只记录**：配置项存在性（是/否）、运行环境、代码版本、产品事实标识
  （User/Project/AgentRun/GenerationJob/ContentReview/Asset id）、规范化终态。
- 证据记录使用 [`evidence-template.md`](./evidence-template.md)。
