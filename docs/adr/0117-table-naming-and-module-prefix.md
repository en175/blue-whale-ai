# ADR-0117：数据表命名规范与模块前缀收敛

- **状态**：Proposed（待评审）
- **日期**：2026-09-24
- **决策者**：lixq（架构讨论会话）
- **关联**：[ADR-0115](0113-self-built-identity-and-billing-supersede-0062.md)、[ADR-0116](0114-java-module-aggregation-and-billing-runtime.md)
- **规格**：`docs/specs/2026-09-24-用户与计费体系架构设计.md` §9–§10

## 背景

新建 identity / billing 两个领域时需要一套命名规范。勘察现状后的事实：

**已有约 70% 的表使用模块前缀**——问题不是「没有前缀」，是三类不一致：

1. **单复数不一致**：`generation_jobs`（复）vs `generation_model_capability`（单），
   同一个模块内两种形态；`conversations`（复）vs `conversation_messages`（单数前缀）。
2. **同名词分裂**：**3 个 skill**（`skill` / `creative_skill` / `user_skill`）、
   **3 个 asset**（`assets` / `material_assets` / `shared_assets`）、
   2 个 user（`users` / `user_info`，后者实为 sk- 存放表）。
3. **少数表无名空间**：`verification_codes` / `command_idempotency` / `homepage_hero` /
   `storyboard_previews` 看不出归属。

**改名的真实成本远低于直觉**：Prisma 的 `@@map` 把模型名与表名解耦——
改 `@@map("identity_users")` 后，TS 侧 `prisma.users` **一行代码不用动**。
真正的成本只在手写 SQL 与 `worker-java`。已核实 `worker-java` 实际接触的 10 张表：

```
assets · generation_jobs · generation_model_capability · generation_output_slots
material_assets · project_asset · project_events
scene_card_generation_records · storyboard_previews · user_info
```

**它不碰 `users` / `verification_codes` / `topup_tiers` / `cost_*`** → 这些表改名零 Java 改动。

## 决策

1. **表名一律复数**。`generation_model_capabilities`、`identity_users`、`billing_credit_lots`。

2. **前缀 = 限界上下文 = 未来库名**。前缀空间收敛为三个：
   `identity_` · `billing_` · `generation_`（沿用已有 `generation_` 前缀，不改短）。
   这样分库那天，`billing_*` 整体搬到 `billing` 库，**表名一个字都不用改**。

3. **其余约定**：
   - 外键 = `{单数表名}_id`（`user_id` · `generation_job_id` · `order_id`）
   - 关联表 = 两表名复数用 `_` 连接（`identity_user_roles`）
   - 唯一索引 `uk_{表}__{列}`；普通索引 `idx_{表}__{列}`
   - 时间 / 软删 / 乐观锁沿用现有：`gmt_create` · `gmt_modified` · `is_delete` · `version`
     （这四项全仓已高度一致，不动）

4. **改名清单（仅限 identity / billing 相关）**：

   | 现名 | 改为 | 碰 worker-java? |
   |---|---|---|
   | `users` | `identity_users` | ❌ |
   | `verification_codes` | `identity_verification_codes` | ❌ |
   | `admin_operation_logs` | `identity_admin_logs` | ❌ |
   | `topup_tiers` | `billing_products` | ❌ |
   | `cost_reservations` | `billing_cost_reservations` | ❌ |
   | `cost_adjustments` | `billing_cost_adjustments` | ❌ |
   | `user_info` | **删除整表** | ✅（断链时本来就要做） |
   | `generation_model_capability` | `generation_model_capabilities` | ✅（补复数） |

5. **其余约 30 张业务表不改名。** 它们物理上留在 business 库，
   `canvas` / `project` / `scene_card` / `template_card` 本身就是模块名，符合规范。
   **不为整齐去改 30 张表的名字**——那是拿真实工时换审美。

6. **同名词分裂不改名，加注释说明边界。** 三个 skill、三个 asset 的边界靠 Prisma 注释承载，
   重命名收益不足以覆盖波及面（含前端、迁移、既有 ADR 引用）。

## 被否决的备选

- **统一去掉所有前缀**（`users` / `lots` / `entries`）：更短，但与已有 70% 的现状相反，
  且多服务共库时无法从表名判断归属。分库后前缀虽显冗余，但**冗余的代价是多打几个字符，
  收益是表名在任何上下文（日志、迁移文件、慢查询）里都自解释**。
- **引入数据库 schema 做分组**：MySQL 的 schema 即 database，没有独立 schema 层，
  此路不通。
- **一次性重命名全部 41 张表**：波及 Prisma + Java SQL + Java 测试的 schema 副本 +
  所有迁移 + 前端引用，收益只是目录整齐。

## 后果

- **正向**：表名自解释；分库时表名不变；新建 identity / billing 表有明确规范可循；
  改名成本被 `@@map` 大幅降低（TS 侧零改动）。
- **成本**：一次迁移（8 张表）；`worker-java` 的 `generation_model_capability` 改名需改
  Java Mapper 与其测试的 `bluewhale-schema.sql` 副本；`user_info` 删除需与 ADR-0115 的
  P5（断 sk- 链）联动。
- **风险**：改名期间若 `worker-java` 与 migration 不同步，会出现「表不存在」的启动失败。
  缓解：改名与 Java 改动同一个 PR；`generation_model_capabilities` 改名放在灰度刀的相邻窗口。
- **成立前提**：Prisma 仍是 schema 权威（ADR-0084 已登记「改表须联动检查 worker-java
  MyBatis-Plus mapper」这一既有约束，本决策把它具体化）。
