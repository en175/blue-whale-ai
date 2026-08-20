# 计费单位契约（产品确认 2026-08-19）

> 本契约锁定蓝鲸（blue-whale-ai）与网关（blue-whale-api，new-api 二开）之间的计费单位口径。
> 依据：`蓝鲸项目-扣费机制调查报告.md` §11 决策 3/7/8、`蓝鲸项目-扣费链路修复-design.md` 领域 0。
> 任何改动不得触碰以下锚点；违反即视为破坏产品计费口径。

## 锚点（不可变）

| 锚点 | 值 | 说明 |
|---|---|---|
| 网关 quota 美元锚点 | **500,000 quota = $1**（`QuotaPerUnit`） | 网关内部所有充值/扣费/结算公式的换算基准，**不动** |
| Go 侧公式 | `getPayMoney` / `TopUp` 语义 / 充值回调公式 | 网关内部实现，**不动** |
| 档位公式 | amount = 原价 × 500,000 | Go 档位充值到账 quota 量纲，**不动** |
| Node 记账换算 | `quotaToFen` = quota ÷ 500,000 × 7.3 × 100（→ 分） | 仅用于 `cost_reservations` 记账，**不动** |

## 蓝鲸展示（唯一换算）

- **积分 = quota ÷ 50,000**（1 元 = 10 积分 = 1 美元 = 500,000 quota；1 积分 = 50,000 quota = 0.1 美元）。
- 实现：BFF `backend/libs/shared/credits/credits.ts` `QUOTA_TO_CREDITS_DIVISOR = 50_000`；
  前端 `web/src/api/auth.ts` `quotaToPoints = quota / 50000`。
- **积分是蓝鲸端概念，网关不认积分**；禁止把"积分"写进任何网关调用、公式或参数。

## 两条换算链路（禁止混用）

```
quota ──÷50,000──► 积分（仅蓝鲸展示层：前端 / BFF 展示字段）
quota ──÷500,000 ×7.3 ×100──► 分 fen（仅 cost_reservations 记账：预留/实扣/释放）
```

- `cost_reservations`（记账）一律用**分**；展示字段（credits / points / 积分）一律用**积分**。
- 禁止把展示系数（quota/50,000）用于记账；禁止把记账换算（quotaToFen）用于展示。

## 禁止

1. 禁止修改网关（blue-whale-api）侧任何计费/换算公式（含 `QuotaPerUnit`、`USDExchangeRate` 参与结算的路径）。
2. 禁止把展示系数（quota/50,000）用于记账（`cost_reservations` 仍用分）。
3. 禁止引入新汇率、新单位或新换算系数替代上述锚点。
4. 禁止在 Node 侧新增任何"改用户余额"能力（quota 账本唯一权威在网关）。

## 回归检查

```bash
# 展示换算只应出现在展示层（credits/usage/recharge 展示字段），不得出现在任何网关调用路径
rg "quotaToCredits|/ 50000|50_000|积分" backend/apps/blue-whale/src --glob '!**/api/recharge/**'
# 记账换算（quotaToFen）只应出现在 cost_reservations 记账路径
rg "quotaToFen" packages/core packages/persistence backend/libs/shared/generation
```
