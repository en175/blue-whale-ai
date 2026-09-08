# TLS 核心指标告警与仪表盘 runbook（IK7G9Y）

## 时间

2026-08-10（2026-08-17 收敛范围：agent/generation worker 进程被 IK813V 删除，agent 侧指标随之下线）

## 背景 / 目标

代码侧把核心指标打成结构化日志，经既有火山 TLS 通道上报（`packages/core/src/tls-writer.ts`，logger 的 `metric` 出口见 `packages/core/src/logger.ts`）：

| event | 指标 | 关键字段 |
| --- | --- | --- |
| `task_finished` | 任务失败率 | `result`、`job_type`、`failure_code` |
| `provider_call` | provider 时延（p95） | `result`、`duration_ms`、`provider`、`operation` |
| `queue_depth` | 队列深度（30s 主动采样） | `queue`、`status`、`depth` |

打点位置：

- `task_finished`：视频任务成功/失败（`packages/generation-runtime/src/video-job-runner.ts`，只在状态迁移成功时计数，fencing 竞态不双计）。派发前被取消的视频任务不计数（任务未开始、未耗 provider 资源，不进失败率分母）。
- `provider_call`：视频 provider `submit`/`poll`（provider=new_api_video）。
- `queue_depth`：当前仅保留 sampler 基建（`packages/core/src/queue-depth-sampler.ts`），未接线任何生产采样器（IKDZJK 清理 bullmq 回退路径后无 `video_bullmq` 队列，事件不再产生）。若未来需要 RocketMQ 口径的队列深度，另行评估 consumer offset/lag。

本文档负责 TLS 控制台侧：字段索引、三条告警、一个仪表盘、送达渠道、人工验证。
明确不做 Prometheus/APMplus（见工单 IK7G9Y）。

范围说明：工单原文含 agent 侧指标（`outcome_unknown`、`provider_call(agent_llm)`、agent run 终态）与两条 DB 队列采样（`agent_runs`/`generation_jobs`）。上游 IK813V 删除了 `apps/agent-worker` 与 `apps/generation-worker` 两个进程，这些落点随之消失，agent 侧指标由后续负责抽离编排的同事重建。本文档仅覆盖现存的视频生成链路。

## 前置

### 0. 部署单元配齐 TLS 环境变量

`packages/core/src/tls-writer.ts` 在以下五个变量**缺任一项**时静默降级为 noop（日志只落 stdout，不进 TLS，指标与告警全链路失明）。视频生成 worker（`backend/apps/generation-worker/src/`）的部署环境要配：

`TLS_ENDPOINT`、`TLS_REGION`、`TLS_TOPIC_ID`、`TLS_AK`、`TLS_SK`

上线后先在 TLS 控制台确认有 `event:task_finished` / `event:provider_call` 日志流入，再配告警（`queue_depth` 未接线，见「打点位置」）。

### 1. 开启字段索引

TLS 控制台 → 日志服务 → 本项目 topic → 索引配置，为以下字段开启**字段索引并开启统计（分析）**：

`event`、`result`、`duration_ms`、`job_type`、`failure_code`、`provider`、`operation`、`queue`、`status`、`depth`

未开启统计的字段无法进入 SQL 聚合，告警查询会报「字段未开启统计」。注意索引**类型**：`duration_ms`、`depth` 选 long（`approx_percentile` / `max` 需要数值型），其余 text。

## 三条告警（控制台 → 告警中心 → 新建告警）

查询窗口与触发条件按工单约定；标注**待定**的阈值先填占位，观察一周后回填（见「阈值观察策略」）。

### 1. 任务失败率 5 分钟 > 10%

```sql
event:task_finished |
SELECT count_if(result = 'fail') * 1.0 / count(*) AS failure_rate
```

- 查询区间：5 分钟；执行间隔：5 分钟
- 触发条件：`failure_rate > 0.10`
- 小样本保护：可加 `HAVING count(*) >= 5`，防任务量极少时单个失败打满失败率

### 2. 队列深度持续 10 分钟 > N

```sql
event:queue_depth AND (status:waiting OR status:"waiting-children" OR status:delayed OR status:active) |
SELECT queue, max(depth) AS max_depth GROUP BY queue
```

- 查询区间：10 分钟；执行间隔：5 分钟
- 触发条件：`max_depth > N`（**N 待定**，占位 50）
- 「持续 10 分钟」语义由查询区间覆盖
- 当前只有 `video_bullmq` 一条队列；状态值为 BullMQ 积压/在途态（waiting 等）

### 3. provider p95 时延超阈值

```sql
event:provider_call |
SELECT approx_percentile(duration_ms, 0.95) AS p95
```

- 查询区间：5 分钟；执行间隔：5 分钟
- 触发条件：`p95 > 阈值`（**待定**，占位 30000ms）
- 视频 `submit` 与 `poll` 量级不同；观察后如需拆分，按 `operation` 各建一条

## 仪表盘

控制台 → 仪表盘 → 新建。每张趋势图配一个**当前值单值图**（查询区间设为最近 5 分钟），值班时一眼看到此刻的水位，不用悬停在趋势末端读数：

1. **任务失败率趋势**（折线）：告警 1 的 SQL 按 5 分钟粒度展开时间轴；配单值图显示当前 5 分钟失败率。
2. **provider p95 趋势**（折线，按 operation 分组）：

```sql
event:provider_call |
SELECT date_trunc('minute', __time__) AS t, operation,
       approx_percentile(duration_ms, 0.95) AS p95
GROUP BY t, operation
```

配单值图显示当前 5 分钟 p95（按 operation 各一个）。

3. **队列深度**（折线，按 queue+status 分组）：

```sql
event:queue_depth |
SELECT date_trunc('minute', __time__) AS t, queue, status, max(depth) AS depth
GROUP BY t, queue, status
```

配单值图显示各队列当前深度（查询区间最近 2 分钟，覆盖 30s 采样周期）：

```sql
event:queue_depth |
SELECT queue, status, max(depth) AS depth GROUP BY queue, status
```

## 送达渠道

- 每条告警配置通知组：至少 **IM 群 webhook + 邮件**。
- 通知组在「告警中心 → 通知管理」预先建好，再挂到告警规则上。

## 阈值观察策略（工单「待定」项）

1. 上线首周：告警 2/3 只开仪表盘观察，或把占位阈值放到必不触发的宽松值，避免噪声。
2. 观察一周真实数据：队列深度峰值与常态水位、provider p95 按 operation 的基线。
3. 一周后把 N 与 p95 阈值回填本文档并收紧告警；更新「## 时间」，并在工单 IK7G9Y 评论记录取值依据。

## 人工触发验证（验收用）

1. **失败率链路**：本地/测试站造一个必失败的视频任务（例如缺少 provider 凭证产生 `provider_credential_missing`），确认 `task_finished result=fail` 日志可查；短时集中造几个失败任务，验证窗口失败率越限能收到告警。
2. **p95 链路**：对 provider 发若干真实/假调用，确认 `provider_call` 带 `duration_ms` 可查、仪表盘 p95 曲线有数。
3. **队列深度链路**：测试站批量入队视频任务并暂停消费，确认 `queue_depth` 每 30s 有新日志、仪表盘曲线上涨；恢复消费后回落（排空时读数归零）。
4. 三条告警各发一条测试通知（控制台「发送测试通知」），确认群/邮件实际收到。

## 关联

- 工单：IK7G9Y（核心指标 + 告警，复用已有 TLS，不引入 Prometheus）
- 队列选型：docs/research/IK3UW2-node-generation-worker-queue-provider-evaluation.md（其 MySQL 队列 worker 已由 IK813V 下线，生产视频链路为 BullMQ）
- 日志通道：packages/core/src/tls-writer.ts（IK6KQQ）；metric 出口：packages/core/src/logger.ts
- 实现计划：docs/superpowers/plans/2026-08-10-ik7g9y-core-metrics-alerts.md
