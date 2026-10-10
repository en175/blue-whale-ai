# 通用积分卡「账户积分与订单」页 前端对接文档

> 需求：《通用积分卡 PRD》模块 D 的用户侧展示面（订单状态 / 积分有效期与流水类型，PRD §9.1 / §9.5 / §9.6）。
> 原型：`通用积分卡-原型-账户积分与订单页.html`（原型 1 · 独立路由页）。
> 版本：**v1（2026-09-30）**。
> 前置阅读：[`docs/specs/2026-09-24-用户与计费体系架构设计.md`](../specs/2026-09-24-用户与计费体系架构设计.md)（批次积分 + 复式账本）、[`docs/specs/2026-09-24-计费逻辑详细设计.md`](../specs/2026-09-24-计费逻辑详细设计.md) §2.3.1（**任何用户可见界面永远只出现一个金额**）、[ADR-0114](../adr/0114-new-api-as-upstream-identity-and-billing-services.md)。

---

## 0. 一句话给前端

原型那一页有 **7 个数据区块**，后端现在只有 **2 个能直接填**。本文档把 7 个都定死成契约：**3 个新增接口、3 处扩字段、1 个页签砍掉**。

标注约定：**【现】** 已有接口直接用 / **【改】** 已有接口要扩 / **【新】** 要新建 / **【不做】** 本期不做。

---

## 1. 页面 → 接口映射

| 区块 | 原型行 | 接口 | 状态 |
| --- | --- | --- | --- |
| 汇总区 · 当前积分余额 | :192–196 | `GET /api/usage/token` 的 `credits` | 【现】 |
| 汇总区 · 积分有效期 | :197 | `GET /api/recharge/tiers` 的 `credits_valid_months` | 【现】 |
| 汇总区 · 最近到期批次 | :198 | `GET /api/usage/token` 的 `expiring` | 【改】控制器补投影 |
| 页签 · 订单记录（7 列） | :213–276 | `GET /api/account/orders` | 【新】 |
| 页签 · 积分明细 / 已获取 | :294–327 | `GET /api/account/credit-lots` | 【新】（含新 RPC `ListLots`） |
| 页签 · 积分明细 / 已消耗 | :330–353 | `GET /api/account/consumptions` | 【改】+5 字段、多值 `type`、`total` |
| 导出弹层 | :394–406 | `GET /api/account/export` | 【新】 |
| 页签 · 积分明细 / 已退回 | :356–376 | — | **【不做】**，见 §6.1 |

---

## 2. 全局约定

| 项 | 值 | 依据 |
| --- | --- | --- |
| 全局前缀 | `api`（**不是** `/api/v1`） | `backend/apps/blue-whale/src/main.ts:51` |
| 鉴权 | HttpOnly cookie `bw_session`，浏览器自动携带；**前端不附加任何令牌头** | `web/src/api/http.ts:97-99` |
| 成功信封 | `{ "code": 200, "data": …, "msg": … }` | `backend/libs/contracts/result.ts:27-29` |
| 前端封装 | `web/src/api/http.ts`；`http.get/post/...` 已处理信封与 `ApiError` | — |
| 超时 | 10 秒（`API_REQUEST_TIMEOUT_MS`） | `web/src/api/http.ts:13` |
| 时间口径 | RFC3339、**北京时间墙钟字面量**（`+08:00`）。前端直接按字面量格式化，**不要再做时区换算** | ADR-0111 |
| 分页 | 本页所有列表统一 **offset 分页 + `total`** | §6.2 |
| 金额单位 | 积分一律**整数积分**；人民币金额字段名带 `_fen` 后缀，单位是**分** | ADR-0114 |

> ⚠️ **两套字面量，别混用。** 批次的 `source` 写 `purchased`，流水的 `type` 写 `recharge` —— 同一件事两个词（`contracts/proto/billing/v1/billing.proto:166-169`）。文案映射表见 §5.4。

---

## 3. 接口契约

### 3.1 【改】`GET /api/usage/token` — 余额与临期批次

**现状**：接口已上线，返回 `credits` + `by_source`。但 gRPC `QueryBalance` 明明还返回了 `expiring`，`billing-client.ts:297-301` 也映射好了，**控制器把它丢了**。

**改动**：`backend/apps/blue-whale/src/api/usage/usage.controller.ts:29-35` 补一项投影。**3 行。**

**响应**

```jsonc
{
  "code": 200,
  "data": {
    "credits": 12345,                        // 整数积分，= Σ(批次 remaining − frozen)
    "by_source": [                           // 【现】已有
      { "source": "purchased", "credits": 11145 },
      { "source": "bonus",     "credits": 1200 }
    ],
    "expiring": [                            // 【改】本次新增
      { "credits": 1200, "expires_at": "2026-12-01T00:00:00+08:00", "source": "purchased" }
    ]
  }
}
```

**口径（必须遵守，都有出处）**

- `Σ by_source` **必须逐字等于** `credits`。对不上是 bug，不是口径差异（`billing.proto:154-155`）。前端 `web/src/stores/auth.ts:26-38` 的 `totalCreditsOf` 已经在做这条校验，复用即可。
- `by_source` 与 `expiring` **都不是第二个金额**，是同一个金额的分量 —— 拆分口径**不等于**允许并排显示两个独立的数（《计费逻辑详细设计》§2.3.1）。
- `expiring` 是「**临期批次**」子集，不是全部批次。原型 :198「最近到期批次」取**第一条**（按 `expires_at` 升序由后端给出）。
- `expiring[].source` 决定文案。文案表见 §5.4。
- 全模型可用说明文案（原型 :195「全模型可用 · 图片 / 视频 / 音频 / Agent 任务」）是**静态文案**，后端不提供，前端写死。

---

### 3.2 【新】`GET /api/account/orders` — 订单记录

**现状**：**没有列表接口**。只有单笔 `GET /api/recharge/order/:tradeNo/status`（`recharge.controller.ts:175-194`）。

**好消息**：数据与分页机器全是现成的 —— 订单表 `recharge_orders` 在本仓 backend 自己库里（`backend/libs/shared/persistence/recharge-order-repo.ts`），管理端 `GET /api/admin/recharge-records`（`api/admin/recharge-records.controller.ts:52`）已经跑通 offset + total + 状态白名单。用户侧只需复用同一套 service（`RechargeService.listOrdersForAdmin`）并把 `userId` 钉死为当前用户 —— 可参考 `loadOwnOrder` 的归属校验写法。

**请求**

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | number | 否 | `1` | 页码，从 1 起 |
| `page_size` | number | 否 | `20` | 上限 100 |
| `status` | string | 否 | 空 = 全部 | 六态之一，非白名单值 → 400 |

**响应**

```jsonc
{
  "code": 200,
  "data": {
    "items": [
      {
        "trade_no": "BW20260929143200801",
        "product_name": "自定义充值 · 600 积分",
        "product_type": "custom",
        "amount_fen": 4000,               // 4000 = ¥40.00，单位是分
        "credits": 600,                   // 基础积分（下单快照）
        "bonus_credits": 0,               // 本单实发赠送积分，没实得恒为 0
        "status": "paid",
        "created_at": "2026-09-29T14:32:00+08:00",
        "paid_at": "2026-09-29T14:32:41+08:00",   // 未支付为 null
        "credits_valid_months": 24
      }
    ],
    "total": 7
  }
}
```

**字段映射（全部来自 `RechargeOrderView`，`recharge-order-repo.ts:419-454`）**

| 原型列（:223-224） | 响应字段 | 备注 |
| --- | --- | --- |
| 下单时间 | `created_at` | ← `gmt_create` |
| 商品名称 | `product_name` | 后端已含档位名/积分数，前端不再拼 |
| 订单编号 | `trade_no` | 复制到剪贴板用 |
| 支付金额 | `amount_fen` | **分**，展示前 `/100` |
| 到账积分 | `credits` + `bonus_credits` | 见下方口径 |
| 状态 | `status` | 六态，见 §5.2 |

**口径**

- **「到账积分」= `credits` + `bonus_credits`**，两个字段都只描述**已实发**的部分，所以直接相加即到账值：
  - `credits` 是**下单快照**的基础积分，订单还在「待支付」时就已有值 —— 不能拿「有没有值」判断到没到账；实发与否只看 `status === "paid"`。
  - `bonus_credits` 是**本单实得的赠送积分**，不是下单快照。首购加赠按 **(用户, 档位)** 幂等发放（`recharge.service.ts` 的 `grantFirstPurchaseBonus`，幂等键 `bonus:tier:<userId>:<tierId>`），**同档位只有首单拿得到**；其余单虽在下单时快照了赠送额度，本字段一律下发 **0**。判断依据是订单的 `first_purchase_state`：`first` → 给 `bonus_credits`，其余（`repeat` / `unknown`）→ 0。
  - 展示规则：`status === "paid"` → 展示 `credits + bonus_credits`（PRD §9.4：到账 = 基础 + 应发赠送，此处的「应发」按实发收敛）；其余状态 → 一律展示 **「—」**，不展示 0（原型 :383 口径①：**查不到 ≠ 0**）。
- 状态六态**没有「已退款」**，且是刻意的（`recharge-order-repo.ts:14`：「退款功能先不做。一个没有出口的状态就是死状态」）。原型 :383 口径①列六态、PRD §9.1 列七态，**以代码的六态为准**。
- 「操作」列只有「复制订单号」（原型 :232），纯前端行为，无接口。

---

### 3.3 【新】`GET /api/account/credit-lots` — 积分明细 · 已获取（批次维度）

**现状**：**没有出口**。批次数据完整躺在 `billing_credit_lots`（`server/blue-whale-billing/src/main/java/com/bluewhale/billing/.../entity/CreditLotEntity.java:22-56`），但用户面和运营面**都没有 `ListLots` RPC**。

**为什么必须是批次维度**：原型 :385 口径③写死「『已获取』为批次维度，每行带积分生效 / 到期时间（落实 PRD 9.5 到期明细可查）」；PRD §9.5 也要求「用户侧可在积分记录中查看到期明细」。现有的 `ListTransactions` 是**流水**维度，且不含到期时间，补不出来。

**这是本单唯一一处需要新增用户面 RPC 的地方**（`contracts/README.md` 约定「RPC 面很小」，ADR-0114 记的用户面只有 `Hold` / `QueryBalance` / `ListTransactions` 三条，本次加到四条）。见 §4。

**请求**：`page` / `page_size`（同 §3.2）。

**响应**

```jsonc
{
  "code": 200,
  "data": {
    "items": [
      {
        "lot_id": "18401",
        "source": "purchased",             // 批次口径，见 §5.4
        "amount": 3000,                    // 该批发放的原始积分
        "remaining": 1200,                 // 该批剩余可用积分（已扣掉冻结？不 —— 见口径）
        "created_at": "2024-12-01T09:12:00+08:00",
        "expires_at": "2026-12-01T00:00:00+08:00",  // null = 永久有效
        "biz_type": "recharge",            // 来源语义（订单/活动/…）
        "biz_id": "BW20241201091200555"    // 订单号；非充值批次可能为 null
      }
    ],
    "total": 3
  }
}
```

**口径**

- **「获取时间」与「积分生效时间」是同一个值。** 原型 :302 画了两列，但本项目批次一写入即生效，不存在延时生效。契约**只给一个 `created_at`**，前端两列渲染同一字段。真出现延时生效需求时再加字段 —— 现在加就是加一个恒等于 `created_at` 的空壳。
- `remaining` 是**该批次尚未消耗的可用量**，不含冻结。要展示「含冻结」的余量不在本期范围。
- `expires_at` 为 `null` 时，前端展示「永久有效」，**不要**渲染成 `1970` 或空白（`CreditLotEntity` 注释：`NULL = 永久`）。
- 原型 :317 的「· 剩余 1,200」是 `remaining` 的展示，仅当 `remaining < amount` 时才拼这段。
- 原型 :318 把临期批次的到期时间标黄（`.expire-warn`）—— 阈值前端定（建议 ≤ 30 天），后端不提供。

---

### 3.4 【改】`GET /api/account/consumptions` — 积分明细 · 已消耗

**现状**：接口已上线（`backend/apps/blue-whale/src/api/account/account.controller.ts:38-69`），但只返回 8 个字段：`id / type / direction / title / credits / status / created_at / settled_at`。**原型的 5 列填不满。**

**改动三处**

1. 响应**加 5 个字段**：`job_id` / `task_type` / `model_id` / `model_label` / `prompt`；
2. `type` 参数**支持多值**（原型 :384 口径②要把「已过期」并进「已消耗」页签，而 `type_filter` 现在是个**单值** `string`，逗号拼接会被上游拒成 `INVALID_ARGUMENT`）；
3. 响应**加 `total`**（§4 共享契约改动）。

**第 1 处怎么落**：与运营面**同一条 join 机器**，不重写。`UserTransaction` 加 `generation_job_id`，backend 控制器拿 id 后调 `JobsService.loadTaskSummaries`（`backend/libs/shared/jobs/jobs.service.ts:135`）批量取 `ChargeTaskSummary { type, modelId, modelLabel, prompt }`，投影方式照抄 `api/admin/consumption-records.controller.ts:121-169`。**管理端已有的四字段空值语义要一并继承**：

- 查不到任务（跨库历史 / 已清理）→ 四字段**全 `null`**，前端回落显示 `title`。**这不是错误** —— 那笔钱确实发生过，只是任务查不到了；
- 任务在、但没有提示词（免费工具族）→ `prompt` **单独**为 `null`。**两者可分辨，不要合并处理。**

**请求**

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `type` | string | 否 | 空 = 全部 | **逗号分隔多值**，如 `consume,expire`。空/非法值回落全部 |
| `page` | number | 否 | `1` | 页码 |
| `page_size` | number | 否 | `20` | 上限 100 |

**响应**

```jsonc
{
  "code": 200,
  "data": {
    "items": [
      {
        "id": "tx_9821",
        "type": "consume",                 // 流水口径，见 §5.4
        "direction": "out",
        "title": "视频生成 · seedance-2.5 1080p 5s",
        "credits": 476,                    // 最终值，唯一金额
        "status": "done",
        "created_at": "2026-09-29T15:02:00+08:00",
        "settled_at": "2026-09-29T15:06:00+08:00",
        "job_id": "2693",                  // 【新增】
        "task_type": "text2video",         // 【新增】generation_jobs.type，自由文本
        "model_id": "doubao-seedance-2.5", // 【新增】
        "model_label": "Seedance 2.5",     // 【新增】展示名
        "prompt": "一只鲸鱼跃出水面…"        // 【新增】
      }
    ],
    "next_page_token": "",
    "total": 4
  }
}
```

**口径（两个最容易写错的地方）**

- **`credits` 是「最终值、唯一金额」，不是预扣额。** 任务失败全额退回时，这一行**就是原来那条** `consume` 行结算到 0（`type` 恒为 `consume`、`direction` 恒为 `out`、`settled_at` 非空、`credits = 0`）。所以：**失败的任务在「已消耗」里显示「消耗 0」**，不会另起一行 `+476`。详见 §6.1。
- 「已过期」并入本页签时用 `type === "expire"` 区分标签（原型 :345 的红色「过期核销」标签），与 `consume` 同表不同色。`expire` 行的 `job_id / task_type / model_id / model_label / prompt` 全为 `null`，原型那两格是「—」。

---

### 3.5 【新】`GET /api/account/export` — 导出明细

**现状**：**零**。前后端都没有任何 xlsx/csv 生成代码（全仓 grep `exceljs / xlsx / json2csv / papaparse / content-disposition` 零命中）。

**为什么放后端**：原型 :398 写的是「导出范围为当前页签**全部记录**」，不是当前页。前端要循环分页拉全量，会撞 10 秒超时；且流水行的 `title` 是后端**预渲染**的字符串，前端拿不到原始维度去拼。所以后端生成流。

**请求**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scope` | `orders` \| `gain` \| `consume` | 是 | 决定字段集与数据源。`orders`→§3.2、`gain`→§3.3、`consume`→§3.4 |
| `fields` | string | 是 | 逗号分隔的字段名，取自该 scope 的字段集（原型 :411-416 的四组）。空 → 400 |
| `type` | string | 否 | 仅 `scope=consume` 有效，语义同 §3.4 |

**响应**：**裸二进制流，不套 `{code, data, msg}` 信封。**

```
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="积分明细-已消耗-20260930.xlsx"
```

> ⚠️ **前端必须绕开 `http.ts` 的统一信封解析**（`web/src/api/http.ts:152` `doRequest` 会把响应体当 JSON 解）。这一条用原生 `fetch` 直取 blob，或给封装加一个 bypass 分支。后端侧已有同类先例：`recharge.controller.ts:206-228` 的回调路由用了 `@BypassTransform`。

**口径**

- 导出**不受分页限制**，是当前筛选条件下的全部记录。
- 字段勾选是**前端弹层**的事（原型 :394-406），`fields` 按原型 :411-416 的四组字段名传，后端只按 `fields` 裁列。
- 字段的中文表头由后端写（不在 `fields` 里传），前端弹层的勾选项文案与后端表头**用同一份**，别各写一套。

---

## 4. 契约层改动清单

| 文件 | 改动 | 影响面 |
| --- | --- | --- |
| `contracts/proto/common/v1/types.proto:28-30` | `PageResponse` 加 **`optional int64 total = 3`** | **全仓共享**。用 `optional` 而非裸 `int64`：proto3 有 presence，未设置 = 「未统计」；拿 `0` 当哨兵会让真·0 条和「没实现」分不开 |
| `contracts/proto/billing/v1/billing.proto` | 新增用户面 RPC **`ListLots`**（请求/响应结构见 §3.3） | 用户面 RPC 从 3 条到 4 条 |
| 同上 | `UserTransaction` 加 **`optional int64 generation_job_id`** | 用户面。**不含** `reserved_amount`（那条硬规则不动，见 §6.1） |
| 同上 | `ListTransactionsRequest.type_filter`：`string` → **`repeated string`** | 用户面。运营面是独立方法，不受影响 |

**账本类的 `total` 从哪来**：`total` 由 billing 侧补一条 `COUNT`。**这是有成本的** —— `billing_transactions` 是 append-only 且全表增长最快的一张表。本次决策为「要」，代价已记在 §6.2。

---

## 5. 前端实现要点

### 5.1 路由

用户侧现在**没有任何积分页路由** —— `web/src/router/index.tsx` 只有 `/`、`/auth-success`、`/canvas`、`/projects`、`/library`、`*`，积分/充值相关全是弹窗（`components/UserDropdown/` 下的 `RechargeModal` / `AccountRecordsModal` / `AccountModal`）。

这一页是**新增独立路由**（原型 :189「独立路由页（非弹层）」）。入口在顶栏余额悬停卡片上（原型 :389 指向**原型 2**，本单不含）。

### 5.2 订单状态映射表（六态，逐字）

| 后端 `status` | 中文 | 原型 :383 口径① | pill 样式（原型 :93-100） |
| --- | --- | --- | --- |
| `pending` | 待支付 | 待支付 | `.gray` |
| `paid_pending` | 支付成功待到账 | 支付成功待到账 | `.warn` |
| `paid` | 已到账 | 已到账 | 默认（绿） |
| `failed` | 支付失败 | 支付失败 | `.err` |
| `expired` | **已取消** | 已取消 | `.gray` |
| `grant_failed` | 到账异常 | 到账异常 | `.err` |

> ⚠️ `expired` 的中文是「**已取消**」，不是「已过期」。这个名字是**历史遗留**（`recharge-order-repo.ts:24` 注释：改名要迁存量行，而它本身没有语义变化）。前端**不要**照字面译成「已过期」。
> ⚠️ `paid_pending` **不是终态**：钱到了、积分还没发，后端会重试发放。界面应维持「等待支付结果…」并继续轮询，不要提示失败（订单状态查询接口的既有注释已经写明）。

### 5.3 列表形态

- 三个列表（订单 / 已获取 / 已消耗）统一 **offset 分页 + `total`**，可复用 `web/src/admin/components/AdminQueryTable` 的 `OffsetPaginationState`（`index.tsx:34`）。
  注意：该组件在 `web/src/admin/` 下，**用户侧引用前先确认是否要跨区依赖**，必要时提炼或另写一份 —— 这是本单唯一的架构取舍点。
- 空态文案统一「暂无记录」（原型 :384 口径②）。
- 筛选控件：本期只做**订单状态**（§3.2 的 `status`）与**消费页签的 `type`**。原型 :217 / :296-298 的日期、任务类型、模型三个筛选器**本期隐藏** —— 后端无对应查询参数，画出来是个不工作的控件。已列入 §7 待确认。

### 5.4 两套字面量 → 文案

**批次口径 `source`**（用于 §3.1 的 `by_source` / `expiring`、§3.3 的已获取）

| `source` | 文案 |
| --- | --- |
| `purchased` | 充值到账 |
| `bonus` | 充值赠送 |
| `gift` | 赠送 |
| `compensation` | 补偿 |
| `daily` | 每日赠送 |
| `invite` | 邀请奖励 |
| `register` | 注册赠送 |
| `redeem` | 兑换 |
| `subscription` | 订阅 |

**流水口径 `type`**（用于 §3.4 的已消耗、§3.5 的导出）

| `type` | 文案 | 出现在 |
| --- | --- | --- |
| `consume` | 任务消耗 | 已消耗 |
| `expire` | 过期核销 | 已消耗 |
| `recharge` | 充值到账 | （`direction=in`，本期不进已消耗页签） |
| `bonus` / `gift` / `compensation` / `daily` / `invite` / `redeem` / `subscription` | 同批次口径文案 | 同上 |
| `refund` | 退款回收 | **目前没有产生者**，保留词，本期不会出现 |

> ⚠️ 同一件事两个词：批次写 **`purchased`**，流水写 **`recharge`**。混用会出现「充值到账」的行在某个表里显示成空白。

---

## 6. 口径与冲突记录

三条与仓库既有文字冲突或需要留痕的决策，写在这里，免得下一个人读到旧注释以为本文档写错了。

### 6.1 「已退回」页签不做 —— 退回不是一种流水类型

原型 :356–376 有一个独立的「已退回」页签（示例行 `+476`、标签「任务退回」），原型 :384 口径②也把它列为「四类流水」之一，PRD §9.6 同样把「任务退回」列为一种流水类型。**本仓的口径与之相反，且已写入权威文档：**

> `GLOSSARY.md:1502-1504` —— **退回（结算到 0）**：任务失败或超时兜底把预扣的积分全额还回去。它在用户流水里**不是一种流水类型**，而是那条消费行结算到 0：类型恒为 `consume`、方向恒为 `out`、金额取终态实际值（0）。
> `_Avoid_: 出成一条「退款 +N」的进账（流水会自己加不出余额）`

契约侧一致：`UserTransaction` 注释明写「**退回不单独成一个类型**」，且刻意不含 `reserved_amount`；唯一能揭示退回的预扣额被挡在用户面外（`billing.proto:195-196`）。

**后果**：用户侧**无法区分**「消耗了 0 积分」和「消耗后全额退回」。照既有账本，失败任务在「已消耗」里显示「消耗 0」。**本期据此砍掉「已退回」页签，子页签从三个变两个。** 原型 :384 口径②的「四类流水」随之改为两类（充值到账 / 任务消耗，后者含过期核销）。

若要恢复该页签，只有两条路：给 `refund` 接一个产生者行，或向用户面暴露预扣额 —— **两条都需产品重新拍板**，且第二条违反 §2.3.1 那条硬规则。

### 6.2 账本列表给 `total` —— 推翻 `AdminQueryTable` 的既有立场

原型的四处「共 N 条」（:275 / :325 / :351 / :374）要求总数。仓库对此有明确相反的文字：

> `web/src/admin/components/AdminQueryTable/index.tsx:47-49` —— 游标分页的形状。**没有 `total`**：账本给不出总数，编一个出来比不显示更糟。

**本次决策为：给。** 共享 `PageResponse` 加 `optional int64 total`，用户面与运营面共用该字段。代价两条：账本每次列表查询多一条 `COUNT`（`billing_transactions` 是全表增长最快的一张）；以及上面那条注释与新契约冲突。

**`total` 的迁移策略**：用户面填真实值；运营面**本期不填**，字段未设置（不是 0）。运营面若要跟进，是后续独立工单，不在本单范围内。

### 6.3 「已过期」并入「已消耗」

原型 :384 口径②。落地方式是 §3.4 的多值 `type` 过滤（`consume,expire`），前端用标签色区分。原型 :333 的「任务类型」筛选器与「已过期」标签是两件事，别混。

---

## 7. 待确认 / 未覆盖

1. **筛选器**：日期区间、任务类型、模型三个筛选器本期隐藏（§5.3）。若产品要求本期就做，需后端在 §3.2 / §3.4 加对应查询参数 —— **请产品确认**。
2. **原型 2（顶栏余额 hover 卡片）**：不在本单。入口与弹层形态需要原型 2 的实物。
3. **购买 / 充值下单链路**（PRD 模块 A/B/C：档位、自定义充值、首购加赠）：不在本单。相关接口已存在（`GET /api/recharge/tiers`、`GET /api/recharge/custom`、`POST /api/recharge/order`），另行对接。
4. **「到账积分」列口径**（§3.2）：**已复核并定稿**。原推导（`paid` 时直接加下单快照的 `credits + bonus_credits`）会把首购加赠重复计入同档位的后续订单 —— 赠送实际按 (用户, 档位) 幂等，只有首单拿得到。现按**实发**收敛：`bonus_credits` 仅在 `first_purchase_state === "first"` 时非 0，其余一律 0。
5. **`docs/api/` 未列入 `docs/README.md` 的分区表**：该目录已有 10 篇同类接口文档，但权威分区表里没有它。文档体系的小缺口，建议另开单补，不在本单改。

---

## 8. 验证

- **契约**：proto 改动后跑 `buf generate`（新 worktree 缺 `contracts/gen` 会导致固定的 TS2307/TS7006 假报错）。
- **接口**：三个新接口 + 两处改动，各自至少一条冒烟 —— 订单列表按 `status` 过滤、消费列表按 `type=consume,expire` 过滤、导出的 `fields` 裁剪与二进制响应头。
- **口径**：`Σ by_source == credits` 的恒等断言（已有 `totalCreditsOf` 校验）；失败任务的消费行 `credits === 0` 且**不出现**在「已退回」表里（该表已不存在）。
- **前端**：`web/` 是独立 npm 管理、不在 pnpm workspace，跑验证前先 `cd web && npm ci`；web 改动需补跑 `node web/node_modules/typescript/bin/tsc -b web/tsconfig.json`（根 tsc 覆盖不到 web）。
