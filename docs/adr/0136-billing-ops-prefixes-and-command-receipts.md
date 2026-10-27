# ADR-0136：计费 / 运维前缀与命令回执归位

- **状态**：已采纳
- **日期**：2026-10-27
- **决策者**：lixq
- **关联**：[ADR-0117](0117-table-naming-and-module-prefix.md)、[ADR-0135](0135-catalog-material-content-prefixes.md)、IKQY3O / IKQWV1

## 背景

计费、运维配置与幂等回执三类表长期处在「无前缀」状态：`recharge_orders`、`cost_reservations` 看不出属于计费域，`system_settings`、`admin_operation_logs` 落在运维域却与业务表混排，`command_idempotency` 实际是项目级命令回执。ADR-0117 §4 曾把其中几张列入「规划改名但未落地」的清单，本次一并对齐。

## 决策

1. 计费域前缀 `billing_`：
   - `topup_tiers` → `billing_products`
   - `recharge_orders` → `billing_recharge_orders`
   - `cost_reservations` → `billing_cost_reservations`
   - `cost_adjustments` → `billing_cost_adjustments`
2. 运维域沿用既有 `bw_`：
   - `admin_operation_logs` → `bw_admin_logs`
   - `system_settings` → `bw_platform_settings`
3. 项目级回执：
   - `command_idempotency` → `project_command_receipts`（它按 `project_id + operation + key` 唯一，是画布与建单命令的幂等回执，不是通用命令表）
   - `legacy_card_history` → `project_card_migration_history`（名字去掉版本性形容词）
4. 只改嵌入完整旧表名的索引（7 条）。`idx_tier_status_sort`、`uk_adj_*`、`idx_oplog_category_created` 不含旧表名，保持原样。
5. `project_card_migration_history` 保留期定为 **180 天**（按 `gmt_create`）：表注释写明保留期与清理入口，清理脚本 `backend/scripts/cleanup-project-card-migration-history.mjs` 默认 dry-run、`--apply` 分批删除。
6. 迁移语句顺序：索引改名在前，8 张表一条多表 `RENAME TABLE` 在后，最后写表注释。

## 后果

- 破坏性发布：数据库 DDL、后端镜像与 worker jar 必须同批上线，旧镜像读旧表名会立即失败。
- `RENAME INDEX` 无 `IF EXISTS`：执行前在目标库 `SHOW INDEX` 核对 7 条索引名；失败按「补完索引改名 → 执行多表 RENAME」恢复。
- billing 服务自己的库（Flyway）里本来就有 `billing_cost_reservations`，与本库新名字同名但属于不同数据库，不要混用连接。
- ADR-0117 §4 的改名清单至此全部落地；其 §2 前缀空间与 [ADR-0135](0135-catalog-material-content-prefixes.md) 一并生效。
