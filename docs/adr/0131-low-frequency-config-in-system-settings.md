# ADR-0131：低频、明文、应用层校验的业务配置存入 `system_settings`

- **状态**：Accepted
- **日期**：2026-10-20
- **决策者**：lixq
- **关联**：工单 IKIUGJ / IKP11K、[迁移 050](../sql/20260927_recharge_custom_config.sql)、[迁移 069](../sql/20261020_ikiugj_recharge_custom_to_system_settings.sql)、[迁移 070](../sql/20261020_ikiugj_drop_recharge_custom_config.sql)、[ADR-0114](0114-new-api-as-upstream-identity-and-billing-services.md)

## 背景

自定义充值的全局参数（最低/最高/默认积分、每元积分、步长、开关、购买权限、白名单、积分有效期）原先是 `recharge_custom_config` 单行表。050 迁移在文件头明确写过「刻意不塞进 `system_settings`」，理由有三条：

1. `system_settings` 存凭证，值走 AES、带 `is_secret`、有轮换语义；
2. 充值配置是商品配置，明文、要按字段查询与校验；
3. 两类东西混在一张表里，迟早有人给商品配置也套上加密，或把凭证当普通 JSON 解析。

这三条在 2026-10 的现场已经不成立或不再重要：

- `system_settings` 已有明文 JSON 先例（`policy` / `rateLimit`，`is_secret = 0`），「只能放密文」不是事实；
- 这些参数实际只有研发/运维偶尔调，并不是高频运营改价——真正高频变动的档位价格在 `topup_tiers`；
- 为一份低频配置单独维护一张表，要同时维护三轨 SQL、独立 repo、parity 测试与删改迁移，成本高于收益；
- 「按字段查询」在该表上并不存在：读写始终是整行/整份配置。

## 决策

### 1. 允许低频、明文、应用层校验的 JSON 配置进入 `system_settings`

- 键名用 camelCase（与 `rateLimit` 同风格），例如 `rechargeCustom`；
- 行必须显式 `is_secret = 0`，不得走 `sealSecret`；
- 值是一份**完整**的 JSON 对象，由应用层负责解析与校验；缺字段、类型不对、JSON 损坏一律 fail-loud，不静默回落默认值；
- 配置版本使用 `system_settings.version` 列，每次保存 +1。该语义目前只对 `rechargeCustom` 生效，其他行保持 0；共享的 `SystemSettingRepo.put` 不递增版本，带版本语义的模块不得复用它。

### 2. 边界：哪些配置仍然独立建表

以下情况继续使用独立表：

- 需要列级类型/约束/索引或按字段查询的配置；
- 高频变更、参与运营改价或需要审计每条记录的配置（如 `topup_tiers`）；
- 凭证、密钥、需要逐行轮换或加密的配置（`credentials` / `upstream` 仍加密）；
- 一份配置天然是多行实体，而不是「一份」。

### 3. `recharge_custom_config` 退役

分两步：

1. `069` 把旧表唯一一行转成 `system_settings.rechargeCustom`，**先于**读新键的镜像执行；键已存在时不覆盖；
2. 新镜像全量上线并验证后，`070` 再 `DROP TABLE recharge_custom_config`。

⚠️ `069` 与 `070` 必须按 standalone SQL 手工执行，**不要跑 `prisma migrate deploy`**：两条迁移同处一批，自动执行器会按序把 `070` 也跑掉，旧表会在新镜像验证前被删。

配置版本从 0 重新起算；历史订单的 `recharge_orders.config_version` 保留旧值，两段序号不连续是有意为之。

## 结果

- 管理端「自定义充值配置」页与 `GET/PUT /api/admin/recharge-custom-config` 保持不变，只换存储；`GET /api/recharge/custom` 与下单快照字段不变。
- 配置损坏时管理端与下单返回 503，错误信息指向 `system_settings.rechargeCustom`；由于 `requireConfig` 先失败，损坏的配置无法通过后台 PUT 自愈，需要人工修 JSON，或删除该行后重跑 `069`（`069` 本身不覆盖已存在的键）。
- 运维直接改库的风险从「改错一列」变成「改坏整份 JSON」；管理端仍是推荐写入口。
- 未来若把这份配置改成高频运营改价，应重新评估：它可能不再满足本 ADR 的适用边界，应迁回独立表或配置中心。
