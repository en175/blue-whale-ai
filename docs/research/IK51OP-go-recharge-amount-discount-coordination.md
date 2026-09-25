# IK51OP 充值改接：Go 团队协调说明（blue_whale 分组 + amount_discount 所有权）

> **范围状态**：本文为 web 充值改接（Model B + A+）落地后，需要 **Go（`blue_whale_api`）团队配合执行**
> 的配置与凭证清单。web 侧改动已在本分支完成（见末节「web 侧已完成」）；Go 侧改动尚未开始，
> 本任务硬约束为「不改 Go 代码」，故下列除 IK5W97 外均为**配置/数据/凭证**项。

关联议题：[IK51OP：后台运营审计日志后端 + 充值档位管理](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK51OP)
后续工单：[IK5W97：Go 侧充值折扣按分组隔离](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK5W97)

## 结论（一句话）

充值目录（档位 CRUD、折扣、限时上下架）在 **web 自己的库**（`topup_tiers`）；结算**复用 Go 原生 new-api 充值**
（`/api/user/amount` 报价 → `/api/user/bluewhalepay/pay` 下单 → `/api/bluewhalepay/notify` 回调），不再走旧自定义
recharge 模块。web 档位的**逐档折扣**通过 Go 全局 `payment_setting.amount_discount` 表达——这要求 Go 侧建一个
中性的 `blue_whale` 分组、迁移用户、并把 `amount_discount` 的写所有权交给 web。

## 定价公式与语义对齐（双方必须一致）

原生充值实付与到账：

```
Money(实付) = N × Price × TopupGroupRatio[group] × AmountDiscount[N]
到账 quota   = N × QuotaPerUnit
```

- `N` = 美元额度，即 web 档位的 `original_price`（正整数，元）。
- `TopupGroupRatio`：**按分组**的充值倍率，单一值（无法逐档表达）。
- `AmountDiscount`：**按金额 N** 的折扣表（`map[original_price]discount`），全局。
- web.discount 与 `AmountDiscount` **同为「实付倍率」**：`0.85 = 8.5 折 = 付 85%`。
  映射**直填**，无需 `1-x`：`AmountDiscount[round(original_price)] = web.discount`。

测试环境常量（当前实测）：`Price=1`、`QuotaPerUnit=500000`、`quota_display_type=CNY`、汇率 1:1、`amount_discount` 初始为空。

## Go 团队需执行项

### 1. 新建分组 `blue_whale`，两个倍率都置 1

路径：`/system-settings/billing/group-pricing`。

- `GroupRatio[blue_whale] = 1`（消耗扣费倍率，置 1 = 不额外打折）。
- `TopupGroupRatio[blue_whale] = 1`（充值倍率，**置 1 = 中性**，让逐档折扣完全由 `AmountDiscount` 承载）。
- 美元/人民币汇率 = 1（测试环境）。

> 之所以把 `TopupGroupRatio` 置 1：它是按分组的单值，无法表达「逐档不同折扣」；逐档折扣只能放
> `AmountDiscount`。若 `TopupGroupRatio` 不为 1，会与 `AmountDiscount` 叠加，导致 web 算出的实付与 Go 不一致。

### 2. 迁移 blue_whale 用户到该分组

把经由 web 充值的用户的 `group` 字段改为 `blue_whale`，使其充值走 `TopupGroupRatio[blue_whale]=1`。

### 3. `amount_discount` 写所有权移交 web

路径：`/system-settings/billing/payment` → 切到「**支付网关**」子标签（计费页默认停在 quota 区）→
滚到底部「**金额折扣**」字段（默认是可视化编辑器）。

- web 在档位 **create/update** 时写 `AmountDiscount[round(original_price)] = discount`；
  档位 **delete** 时移除该 key。
- web 采用**整表增量合并**（读旧表 → 改自己档位的 key → 整表写回），不覆盖人工保留的其他档位。
- 一旦 web 接管，**Go 后台不要再手改该字段**，否则会与 web 档位漂移。

### 4. ⚠️ 凭证：web 写 `amount_discount` 需要 Go ROOT 凭证（#10 的阻塞点）

写 `payment_setting.amount_discount` 走 `PUT /api/option/`，该路由用 **`RootAuth`**
（`blue_whale_api/router/api-router.go` 的 `optionRoute.Use(middleware.RootAuth())`），**比 AdminAuth 更严**。

`authHelper` 接受两种凭证，但**两者都要求 ROOT 角色 + `New-Api-User` 头**（`middleware/auth.go`）：

- session cookie（后台登录态），或
- `Authorization: <sk- access token>`（`ValidateAccessToken`），
- 且必须带 `New-Api-User: <root 用户的数字 id>` 头。

**请 Go 侧为 web 后端预置一个 ROOT access token + 对应 root user id**，经环境变量注入 web。

> ⚠️ **本条已失效（2026-09-25 记）**：当时以为会接线的 `NEW_API_ROOT_ACCESS_TOKEN` /
> `NEW_API_ROOT_USER_ID` 两个变量**从未落地**，现已整条退役——`NEW_API_ROOT_USER_ID`
> 全仓零引用，`NEW_API_ROOT_ACCESS_TOKEN` 被「技能格式化」当普通模型调用误用（无 root 语义），
> 已改走项目唯一那把上游凭证 `NEW_API_UPSTREAM_KEY`。`deploy/local/` 目录与
> `loadGoDiscountSyncConfig` / `loadGoTopUpCredentials` 都不存在。折扣同步的 RootAuth 管理面
> 随后也随 TS 侧管理面一并切断（见 ADR-0114 补记 7）。

## 已知泄漏与后续工单（IK5W97）

`AmountDiscount` 是**全局**的（按金额，非按分组/入口）。`getPayMoney`（`controller/topup.go`）对**所有原生渠道、
所有分组**都读它——因此 web 档位的折扣会**泄漏到 Go 自己的充值面**：Go 后台用户充值时也会吃到 web 设的折扣。

- 配置**无法**隔离：`AmountDiscount` 按金额全局；`TopupGroupRatio` 按分组单值、无法逐档表达。
- 原生下单体只带 `{amount, way_code}`，**无来源标记**；唯一可区分信号是用户分组。
- 解法（须 Go 代码，归 IK5W97，二选一）：
  1. **✅ 采用**：`getPayMoney` 里按用户分组 scope `AmountDiscount`（只对 `blue_whale` 应用 web 折扣）；
  2. ❌ 不采用：给原生订单加来源字段，按来源决定是否套 `AmountDiscount`。
- **时序硬约束**：IK5W97 必须在「Go 原生充值面对终端用户开放」之前合入；在那之前 Go 后台充值仅内部可见，泄漏可接受。

### 方案决策（2026-08-03）：采用方案一「分组门」

- `getPayMoney`（`controller/topup.go:152`）**已带 `group` 形参**，只需在折扣查找（约 :170）外加一层分组判断：仅当分组命中「折扣分组」（缺省 `blue_whale`，建议做成可配置项而非写死）才应用 `AmountDiscount`。
- 三处调用方（报价 `RequestAmount` / epay 下单 `RequestEpay` / bluewhalepay 下单 `RequestBlueWhalePayPay`）共用 `getPayMoney`，**报价与下单天然一致**，不会出现「报价有折扣、下单没有」。
- **无 API 变更、无 DB 迁移、web 侧零改动**；`group` 由服务端 `GetUserGroup` 查库得出、非客户端传入，不可伪造。
- **前置依赖**：用户须已迁入 `blue_whale` 分组（本文 Go 侧 #2）。
- ⚠️ **mock 期注意**：web 当前用 root（default 组）充值，门一开 root 拿不到折扣、现有测试流会断。上线时要么把测试用户迁入 `blue_whale`，要么把门做成可配置分组（测试期把 `default` 也算进去）。
- 方案二（来源标记）不采用：`source` 由客户端传入、可伪造（Go 用户可伪造 `source=blue_whale` 白嫖 web 折扣），须额外服务端门禁；且要动请求体 + `TopUp` model + DB 迁移，代价高于收益。
- ⚠️ **两方案均不解决 web 内部同原价档位碰撞**：`AmountDiscount` 按金额做 key，web 两个同原价档必互相覆盖（如 id=3/id=7 同为 ¥2）。属「逐档折扣 vs 按金额全局表」的更大重设计，不在 IK5W97 范围。

## 耦合常量提醒

`QuotaPerUnit` 在 web 侧被硬编码派生积分：单一来源是 `blue_whale_web/lib/topup-tier/constants.ts` 的
`QUOTA_PER_UNIT = 500_000`（`deriveTierAmount(originalPrice) = round(originalPrice) × QUOTA_PER_UNIT`），
管理端表单（`app/admin/tiers/page.tsx`）与档位路由（`app/api/admin/topup-tiers/*`）都从此处导入，
积分由服务端派生落库、不信任客户端传入的 amount。**Go 侧若调整 `QuotaPerUnit` 环境配置，
须同步通知 web 修改此常量**，否则档位表单展示的到账积分将与实际到账不符。

## 依赖与顺序

1. **先**：建 `blue_whale` 分组（#1）+ 迁移用户（#2）+ 预置 ROOT 凭证（#4）→ web #10 才能写 `amount_discount`（#3）。
2. **后**：web #10 接管 `amount_discount`，档位折扣端到端生效。
3. **独立但限时**：IK5W97（Go 代码）须在 Go 原生充值用户可见前合入。

## web 侧已完成（本分支）

- **#9 充值下单改接原生端点**：
  - `POST /api/recharge/order` → `requestTopUpAmount`（`/api/user/amount` 报价）+ `createBlueWhalePayTopUp`
    （`/api/user/bluewhalepay/pay` 下单）；wayCode 映射 `wechat→WX_NATIVE`、`alipay→ALI_QR`。
  - `GET /api/recharge/order/[tradeNo]/status` → `getTopUpByTradeNo`（`/api/user/topup/self?keyword=<tradeNo>` 精确匹配），
    Go `success` → 前端 `paid`，`paid` 时取 `/api/usage/token` 余额作 `credits_after`。
  - `POST /api/recharge/order/[tradeNo]/cancel` → 鉴权幂等 no-op（原生无取消端点，pending 单自动过期）。
  - 原 502（web 档位 vs Go `recharge_tier` 两套数据源「档位不存在」）随改接消除：原生下单只认 `amount`(N)，不校验 tier_id。
- **#11 档位表单积分只读派生**：原价为主输入，积分 = 原价 × 500000 只读派生展示，落库以原价为准。
- **档位数据约束（评审后收敛）**：
  - 原价强制为**正整数**（对齐 `AmountDiscount` 的整数 key），小数/非数字 → 400；
  - 到账积分由**服务端派生**（`deriveTierAmount`），客户端传入的 `amount` 一律忽略；
  - **一个原价只能有一个档位**（create/update 查重，碰撞 → 409）——同原价两档会互相覆盖
    `AmountDiscount[N]`，见上文 IK5W97「两方案均不解决」段；
  - 档位 CRUD 的审计写入在**服务端路由内**完成（`lib/topup-tier/operation-log.ts`），前端数据层不再写审计；
  - 折扣同步失败**不阻断**档位保存，但响应带 `warning` 且前端 alert 提示到 Go 后台核对；
  - 同步为进程内串行 RMW（`serialized` 队列），并发建档不丢 key。
- **充值接口令牌门禁**：下单/查单/取消均经 `withAuthenticatedUser`（Go `/api/token/identity` 真校验，
  非仅查 `sk-` 前缀）——下单以 root 凭证执行，令牌不真校验等于任意字符串都能以 root 下单。
- core 客户端新增 `requestTopUpAmount` / `createBlueWhalePayTopUp` / `getTopUpByTradeNo`（`packages/core/src/new-api-client.ts`），
  对原生 `{message:"error"}` HTTP-200 错误壳做了显式类型化映射。

## 核验范围

本文为协调说明，不含代码核验；web 侧改动的测试覆盖见各 PR 描述（topup-tiers 路由 / 折扣同步 /
充值下单与查单路由等 60 测全绿）。
Go 侧 #1–#4 完成后，建议在测试环境用一个 `blue_whale` 分组用户走一遍「web 建带折扣档位 → 下单 → 实付 = 原价×折扣」回归。
