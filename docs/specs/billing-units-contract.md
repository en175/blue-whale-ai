# 计费单位契约（产品确认 2026-08-19）

> 修订 2026-09-25：自建计费（[ADR-0114](../adr/0114-new-api-as-upstream-identity-and-billing-services.md)）落地后，
> 蓝鲸侧的积分口径改为**定价目录的配置项**「1 元 = 15 积分」，不再是本文档原先写死的「quota ÷ 50,000」；
> 原「禁止在 Node 侧新增任何改用户余额能力」一条已被 ADR-0114 取代，标记作废。
> **网关内部**的 quota 美元锚点仍然有效（网关还在跑，那是它内部的事）。
>
> **2026-09-25 修订二**：档位公式与 Node 侧记账换算两条**一并作废**——我们不再经由网关
> 记账，代理侧也没有 `cost_reservations` 这个账本了。剩下的锚点只约束**网关自己**。

> 本契约锁定蓝鲸（blue-whale-ai）与网关（blue-whale-api，new-api 二开）之间的计费单位口径。
> 依据：`蓝鲸项目-扣费机制调查报告.md` §11 决策 3/7/8、`蓝鲸项目-扣费链路修复-design.md` 领域 0。
> 任何改动不得触碰以下锚点；违反即视为破坏产品计费口径。

## 锚点（不可变：仅指**网关内部**口径）

> 下面四条描述的是**网关（new-api 二开）内部**怎么换算与记账。网关还在跑，这些口径不动。
> ⚠️ 它们**不**决定蓝鲸侧「1 元 = 多少积分」——那是定价目录的配置项，见下一节。

| 锚点 | 值 | 说明 |
|---|---|---|
| 网关 quota 美元锚点 | **500,000 quota = $1**（`QuotaPerUnit`） | 网关内部所有充值/扣费/结算公式的换算基准，**不动** |
| Go 侧公式 | `getPayMoney` / `TopUp` 语义 / 充值回调公式 | 网关内部实现，**不动** |
| ~~档位公式~~ | ~~amount = 原价 × 500,000~~ | **作废（2026-09-25）**：档位到账积分改为 `原价 × creditsPerYuan`（读 billing 定价目录，当前 15），走我们自己的账本；网关的 Go 档位同步已是 no-op。见 ADR-0114。 |
| ~~Node 记账换算~~ | ~~`quotaToFen` = quota ÷ 500,000 × 7.3 × 100（→ 分）~~ | **作废（2026-09-25）**：`cost_reservations` 随 IKEF1K 退役，生成任务不再往它写金额（回到 `0 + 四版本 "dev"` 兜底），该函数已随之删除。见 ADR-0114。 |

## 蓝鲸展示（1 元 = 15 积分，**配置项而非硬编码**）

- **积分 = 元 × creditsPerYuan，当前生效值 `creditsPerYuan = 15`，即 1 元 = 15 积分。**
- 它是**定价目录 `billing_pricing_catalogs` 的配置字段**（`document.creditsPerYuan`），不是代码里的常量：
  - 与目录一起**版本化**、可整体回滚；
  - 随 job **冻结**——结算按冻结版本复现，改价不影响已提交任务；
  - 改口径 = 发一版新目录，不改代码、不重启（`POST /admin/catalogs`）；
  - 管理端可查当前值：`GET /admin/catalogs/active` → `creditsPerYuan`（发布接口回包同样带它）。
- 编译期校验：`creditsPerYuan` ≤ 0 或 > 100000 的目录**发不出去**（`CatalogCompiler`）。
- ⚠️ **旧口径已作废**：原先的「积分 = quota ÷ 50,000（1 元 = 10 积分）」
  （BFF `backend/libs/shared/credits/credits.ts` 的 `QUOTA_TO_CREDITS_DIVISOR = 50_000`、
  前端 `web/src/api/auth.ts` 的 `quotaToPoints = quota / 50000`）是**网关 quota 时代**的展示换算，
  与自建计费账本没有换算关系。存量代码清理见 [ADR-0114](../adr/0114-new-api-as-upstream-identity-and-billing-services.md)。
- **积分是蓝鲸端概念，网关不认积分**；禁止把"积分"写进任何网关调用、公式或参数。

## 两条换算链路（禁止混用）

```
元 ──×creditsPerYuan（目录配置，当前 15）──► 积分（蓝鲸计费账本与展示的唯一口径）
quota ──÷500,000 ×7.3 ×100──► 分 fen（仅网关侧 cost_reservations 记账：预留/实扣/释放）
```

- `cost_reservations`（网关侧记账）一律用**分**；展示字段（credits / points / 积分）一律用**积分**。
- ⚠️ 作废的第三种链路：`quota ──÷50,000──► 积分`。它是 quota 时代的展示换算，
  与 billing 账本无关，不得用于任何新代码。
- 禁止把网关的记账换算（quotaToFen）用于蓝鲸积分展示或 billing 账本。

## 禁止

1. 禁止修改网关（blue-whale-api）侧任何计费/换算公式（含 `QuotaPerUnit`、`USDExchangeRate` 参与结算的路径）。
2. ~~禁止把网关的记账换算（quotaToFen）用于蓝鲸积分展示或 billing 账本~~ —— **作废（2026-09-25）**：`cost_reservations` 已退役、`quotaToFen` 已删除。billing 账本一律用**整数积分**。
3. 禁止在**网关侧**引入新汇率、新单位或新换算系数替代上述锚点（蓝鲸侧的积分口径见上一节，不属此列）。
4. 禁止把「1 元 = 多少积分」写死成代码常量——它是定价目录的配置项，只能从目录文档读。
5. ~~禁止在 Node 侧新增任何"改用户余额"能力（quota 账本唯一权威在网关）。~~
   **【已作废，2026-09-25】** 由 [ADR-0114](../adr/0114-new-api-as-upstream-identity-and-billing-services.md) 取代：
   蓝鲸自建计费账本（`billing-svc`，批次积分 + 复式账本），网关不再是计费权威。
   余额变更走 billing 的账本写入路径，不再受此条约束。
   ⚠️ 仍然成立的部分：网关的 quota 账本**不是**蓝鲸账本的一部分，不得当作余额来源读写。

## 回归检查

```bash
# 【作废的旧展示口径】quota÷50,000 只应剩存量代码，不应出现在任何新路径
rg "quotaToCredits|/ 50000|50_000|积分" backend/apps/blue-whale/src --glob '!**/api/recharge/**'
# 网关记账换算（quotaToFen）只应出现在 cost_reservations 记账路径
rg "quotaToFen" packages/core packages/persistence backend/libs/shared/generation
# 换算率不得在代码里硬编码：只应出现在目录文档与测试夹具
rg "creditsPerYuan" --glob '!**/blue-whale-billing/**'
```
