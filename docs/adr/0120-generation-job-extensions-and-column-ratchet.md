# ADR-0120：generation_jobs 任务特有字段的扩展位表与列数棘轮

- **状态**：Accepted
- **日期**：2026-09-30
- **决策者**：lixq
- **关联**：[ADR-0117](0117-table-naming-and-module-prefix.md)（表命名与索引命名规范）、[ADR-0084](0084-generation-worker-java-runtime.md)（worker-java 迁移：改表须联动 MyBatis-Plus mapper）、[ADR-0017](0017-product-persistence-idempotency-and-recovery.md)（产品持久化：幂等与恢复）
- **工单**：IKJCOE
- **影响面**：`generation_jobs` 表结构（-15 列）、新增 `generation_job_extras`、worker-java 的领取投影与视频终态守卫、backend 的读路径投影

## 背景

`generation_jobs` 到 2026-09 已 **42 列**，且每来一单就往主表加列——最近一次是
`20260929120000_generation_jobs_video_sample_stage`（IKIZQ8）**一单加了 7 列**。

代价是具体的、不是审美问题：

1. **读路径为每一列付费**。`backend/libs/shared/persistence/job-repo.ts` 的
   `listByUser` / `listForAdmin` 是 Prisma `findMany` **不带 `select`** —— 全列返回。
   每加一列，列表页就多传一次；而大多数列对大多数 `type` 恒 NULL（这张表已经是
   image / video / audio / 抠图 / 擦除 / 混音 / 音视频合成 / media_extract … 的稀疏并集）。
2. **加一列要同步 5 处**：`schema.prisma` + 三轨 SQL + parity 测试 + worker-java 的
   `GenerationJobEntity` + 可能还要改 `GenerationJobMapper` 的 SQL 与金标。
3. **没有闸**。加列是单文件改动，评审时看不出「这是第 43 列了」。

## 决策

### 1. 新增键值扩展表 `generation_job_extras`

```sql
generation_job_extras(
  id, generation_job_id, extra_key, value_type, value_text, gmt_create, gmt_modified,
  UNIQUE uk_generation_job_extras__job_key(generation_job_id, extra_key)
)
```

- **`extra_key` 沿用被迁移列的原字段名**（`video_stage` / `charge_state` / …）。读方不用维护
  一层新旧名字映射，回填语句与代码里的键名逐字对得上。
- 列名是 `extra_key` 不是 `key`：`KEY` 是 MySQL 保留字，手写 SQL 全要反引号，漏一个就是 1064。
- **不建 `generation_job_id` 单列索引**：唯一索引的最左前缀已覆盖「按 job 取全部扩展位」。
- **不带 `is_delete` / `version`**：追加型子表，跟随 `generation_job_logs` /
  `generation_output_slots` 的既有惯例（ADR-0117 决策 3 的四标准列是「沿用现有」，不是每表必备）。
- **不建关系字段**：全仓 `schema.prisma` 有 0 个 `@relation`，子表一律
  「父表先查 + 子表二次查询 + 内存聚合」（模板：`JobFinalizer` 的槽位读法、
  `storyboard-preview-repo` 的父→子投影）。
- `value_type ∈ string / number / boolean / json`；`number` 存十进制字符串
  （TS `Number()` / Java `Long.parseLong` 对称）。**上限**：超过 2^53 的值必须用 `string`。

### 2. 进主表列的三条判据

新字段**先答三问**，三个都不满足就走扩展位 / `generation_job_logs` / `input`：

1. **要进领取或终态 CAS 的 SQL**（`WHERE` 条件，或同一条 `UPDATE` 的 `SET` 表达式）→ 必须在主表行上。
2. **是所有 `type` 共用的生命周期列**（status / lease / fencing / source / …），不是某个 type 专有。
3. **列表页要投影它，且不值得为此多一次子表查询**。

### 3. 加列必须过闸（列数棘轮）

`backend/libs/shared/persistence/generation-jobs-column-guard.test.ts` 冻结主表的 27 列清单，
解析 `schema.prisma` 比对。加列/删列会让它变红，把「要不要加这一列」逼到评审台面上；
确有正当理由时，作者必须**在同一个 commit 里**更新该清单并在本 ADR 补一条理由。

这条闸是本次改造真正解决问题的那一半——**建一张表并不能阻止别人继续加列，让加列变红才可以**。

### 4. 本次逐列处置

**删除（7 列 + 1 索引）**

| 列 | 依据 |
| --- | --- |
| `stage_id` | 零读零写；唯一命中是 Java 实体的 `@TableField`；本地库 142 行 0 非空。出处是已归档的 `docs/archive/agent-workspace/` |
| `evidence_reconcile_until` | 零读零写 |
| `agent_run_id` | 全仓无调用方传 `agentRunId`（含测试）；0/142。计划通道已退役 |
| `next_poll_at` + `idx_status_next_poll` | 只写不读：领取门是 `next_action_at`（`GenerationJobMapper` 的候选查询），它存在的唯一理由是撑那条索引 |
| `action_identity` `project_action_identity` | 同值双份、零读；真实副本在 `cost_reservations.action_identity` 与 `command_idempotency.idempotency_key` |
| `expected_output_count` | 恒 1（本地 142 行无例外）；权威在建行时的 `input.expected_output_count` 快照——`createJobWithinTx` 与 `handle-create-generation-job` 都写这个键（评审 I2/C2 后补全：`createJobWithinTx` 统一在落库前补齐，storyboard_preview 的 count 不再丢）；15 个工具族 service 走直连建行、本就是单输出，缺键即 1。槽位权威在 `generation_output_slots` 行数 |

**搬进扩展位（8 列）**：`strategy_version` `canvas_card_state` `video_stage` `final_job_id`
`upstream_created_at_ms` `finalize_deadline_ms` `charge_state` `actual_credits`。
迁移里**先建表、再回填、最后 DROP**（DDL 非事务，回填晚于 DROP 就是直接丢数据）；
缺键即缺省语义，故只回填有值的行（`canvas_card_state` 只回填 `<> 'pending'`）。

**保留（27 列）**：CAS/领取必需、租约/运行时、通用列。其中
`source_sample_job_id` **必须留**——它扛唯一索引 `uk_generation_jobs__source_sample_job_id`，
是并发裁决点；扩展表的唯一索引只能是 `(generation_job_id, extra_key)`，
改成按值唯一会让所有同 `extra_key` 的行互相撞。

### 5. 守卫 SQL 的同表表达式改入参（本次最需要评审的取舍）

`publishVideoGuard` 原来在**同一条 UPDATE** 里写
`upstream_created_at_ms = COALESCE(#{x}, col)`、`charge_state = IF(video_stage IS NOT NULL, …)`。
这两列搬走后，条件与写入都改到应用层：

- 判据 `video_stage IS NOT NULL` → `JobFinalizer.isTwoPhaseVideo(jobId)`（读扩展位）。
- 写入时机 → **同一 `@Transactional` 内、守卫返回 `affected == 1` 之后**。
  原子性由事务保证：守卫 0 行则整个事务回滚，不会留下「已 succeeded 但费用状态没落」的半成品。
- 「非空才写」语义（原 `COALESCE`）→ 调用方判空后再调 `upsert`，不写就什么都不做。

**这是本决策的真代价**：把一条 SQL 内的原子性换成了「一条 SQL + 一次子表写，靠事务兜」。
成立前提是守卫与续写**必须同处一个 `@Transactional`**，且续写**必须在 `affected==1` 之后**。

### 6. 纠正一处既有文档的错误

`docs/specs/2026-09-10-ikel4a-worker-java-migration-contract.md:42` 把 `execution_deadline_at`
列进「死列（全仓无读写）」。**这条是错的**：`JobClaimService` 把它投影进 `ClaimedJob`，
`AudioMixJobProcessor` / `AudioVideoMuxJobProcessor` 用它做超时预算。照那份清单删会出事。
本次已在 `GenerationJobEntity` 上就地注明。

## 被否决的备选

- **把任务特有字段塞进已有的 `input` JSON**（最省事）。否决：`input` 是**请求快照**，
  会经 `publicGenerationInput` 漏进 API 响应，且 `job-input-purity` 这道闸只拦「不可序列化」
  （函数/符号/bigint/环），**对语义不设防**——纯 JSON 形态的运行时状态会原样通过。
  请求快照与运行时状态混在一列，日后无法回答「这个值是谁写的」。
- **复用 `generation_job_logs.payload`**（仓库已有先例：场景切分的 `result` 就是从终态日志读的）。
  否决：那是 append-only 的**事件流**，读「某个键的当前值」要取最新一行并处理覆盖顺序；
  把一个「当前状态」塞进只增不改的审计表，审计语义会被污染。
- **每个 type 一张 1:1 卫星表**（如 `generation_job_video_stages`）。否决：类型级专用表仍是
  「一种类型加一次表」，只是把加列的频率换成加表的频率，没解决「不可控」；且 15 个工具家族
  各一张表，读路径要 join 的分支爆炸。
- **给扩展表加 `@relation` / 外键**。否决：违背全仓「0 个 `@relation`、子表手工二次查询」的既有形态，
  且 Prisma 的关系过滤在 MySQL 上会退化成 join，与「按 job 一次 `in` 查」的批量范式冲突。
- **值列用单个 JSON 列**（`value_json`）。否决（本次由用户拍板用 `value_text` + `value_type`）：
  带类型判别列能让读方少猜类型，且跨语言（TS ↔ Java）的金标对账里，`number` 的十进制字符串
  形态比 JSON 数字更不容易出现两端精度约定不一致。

## 后果

- **正向**：主表 42 → 27 列；新类型/新特性加字段是**加数据**不是加列；列数棘轮让「又要加列」
  在 CI 上可见；`job-repo` 的列表页与详情页不再为恒 NULL 的列付费；三处死列与两份重复列被清掉。
- **成本**：读路径多一次 `generation_job_extras` 的批量查询（列表 20 行一次 `in` 查）；
  worker 终态多一次 SELECT（`isTwoPhaseVideo`）+ 至多 3 次 `upsert`；
  `canvas_card_state` 的 Prisma `where` 改成「先取 id 再 update」（单个项目的 audio_mix 任务量很小）。
- **风险**：两阶段视频终态的原子性从「单条 SQL」变成「事务内两步」。
  ⚠️ **口径更正（评审 M1）**：`charge_state` **不驱动 billing 结算** —— billing 读自己的库
  （`billing_cost_reservations`），对 `generation_jobs` 零引用；结算事件由终态路径直接
  publish，不按 `charge_state` 分支。`charge_state` / `video_stage` 如今的读方只有三处：
  契约 wire schema、API 投影（`job-repo` → 前端）、以及 `checking` 行的人工核对查询
  （`VideoJobProcessor` 的 runbook，本单已改写为 join 扩展位）。
  真正要守的是**状态与终态事件不发散**（守卫落 `succeeded` 却漏写阶段状态），
  所以「守卫与续写同一事务、续写在 `affected==1` 之后」这条不变量照旧成立。
  缓解：视频金标（G02/G06/G09/G11/G12/G14）与真库集成测试全绿。
  **任何拆分这两个步骤的重构都视为回归。**
- **本次改造暴露的盲区（写在这里，下次删列直接用）**：删列后「哪里还在写这个列」
  **`tsc` 查不出来**——Prisma 7 的 `create<T extends XCreateArgs>(args: SelectSubset<T, …>)`
  从字面量反推 `T`，未知名照样过；假 prisma 单测（手搭 `generation_jobs: { create }`）
  更是照单全收。本单因此漏掉 15 个 service 的直连 `create`（评审 C1），
  唯一能拦住它的是**门控真库集成测试**（如 `IKIHPL_TEST_DATABASE_URL` 那类）。
  结论：**删列必须跑门控集成测试**，并把「哪些门变量没设」如实写进验证凭证，
  不要把跳过折进「N skipped」了事。
- **成立前提**：`value_type` 的编码约定在 TS 与 Java 两侧逐字对称；超过 2^53 的数值用 `string`
  （epoch 毫秒 1.7e12 安全）。EAV 天然不支持「按值范围查/排序」——**需要按某键筛选任务时，
  该键就不属于扩展位**，按上面第 2 条判据回到主表。
