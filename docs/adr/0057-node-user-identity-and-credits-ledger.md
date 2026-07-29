# ADR-0057：Node user 身份（UUID + 简化鉴权）与 Node-owned credits 账本

- **状态**：Accepted
- **日期**：2026-07-27
- **决策者**：朱建业（trueBurger）
- **关联工单**：[IK4AJJ](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4AJJ)
- **上游决策**：[ADR-0055](0055-prelaunch-typescript-unification-scope.md)、[ADR-0056](0056-business-api-into-nextjs-route-handlers.md)
- **相关**：[ADR-0021 统一人民币计费](0021-unified-rmb-billing.md)（Go quota 语义，不在本次范围）、IK3UW5（Go-Node 支付对账，未解）

## 背景

仓内现存在 **3 套互不对账的 user 标识**：

1. Java `users`（`BIGINT` 自增、手机号唯一、**只管身份**，无余额），库 `blue_whale`。
2. Go new-api `users`（`int`、**点数 quota 唯一在此**，独立库）。
3. web 匿名 `X-User-Id` UUID（`bw-user-id`，Node product-api skeleton 在用，「只识别不校验」）。

三者无映射表、无对账代码。Node baseline（`001_baseline.sql`）连 `users` 表都没有，`projects.user_id VARCHAR(36)` 悬空。generation 当前**不扣任何点数**——Java `CostReservation`（CNY 分）只是防滥用护栏，不是账本；生成直接用平台 API key 调 Provider，不经过 Go。

Java 运行时即将退役（ADR-0056），Node 必须接手身份；ADR-0055 明确 fresh schema、无生产数据需迁移；支付建设已 defer，Go-Node 对账是 IK3UW5 未解难题。

## 决策

1. **Node 新建 `users` 表，主键 `UUID VARCHAR(36)`**（与 baseline `projects.user_id VARCHAR(36)` 一致）。不继承 Java `BIGINT` user。
2. **简化鉴权（先跑通）**：首请求按 web 现有 `X-User-Id`（匿名 UUID）自动建档 `users` 行 + Node 签发 JWT；后续请求带 JWT。web 弃用「只识别不校验」的纯匿名，改 JWT。**手机号 + SMS 登录移植延后**（见 OPEN-QUESTIONS）。
3. **新建 `user_credits` 账本**：中性整数 `credit`，不绑 CNY 分、不绑 Go `QuotaPerUnit`。generation 扣减 Node 账本；新用户种子 N credits（具体值待定，便于 demo）。每模型扣减额（价格目录）→ generation slice 再定。
4. **`projects.user_id` → FK `users.id`**，消除悬空引用。
5. **Go new-api 保持独立、不动**。Canvas 点数与 Go 的 relay quota **不互通**；支付对账 post-launch（ADR-0055 已 defer；IK3UW5 未解，本次不解决）。
6. **`CostReservation` 与账本的关系**（reserve / settle 语义）→ generation slice 定；CRUD 阶段只提供 balance 读 + 简单扣减原语。

## 连锁影响

- `users` + `user_credits` 加入 `schema.prisma`（见 ADR-0058）。
- `packages/core` 增加用户上下文（从 JWT 解析 user_id）+ credits 读写用例。
- `blue_whale_web` 鉴权从「匿名 X-User-Id」升级到 JWT；`lib/api/userId.ts` 的匿名 UUID 用于**首次自动建档**，之后用 JWT。
- OPEN-QUESTIONS：phone-SMS 登录移植；初始 credits 数值；credits 与 Go 对账（post-launch）。

## 被否方案

- **代理 Go quota**（Canvas 点数 = Go new-api quota，Node 每次生成调 Go 扣）。拒绝理由：需先建 Java/Node user ↔ Go user 映射 + 对账，IK3UW5 明确未解；pre-launch 工作量过重，且把每次生成都耦合到跨服务同步调用。
- **继承 Java `BIGINT` user**。拒绝理由：违反「退役 Java」（ADR-0056）与 ADR-0055 的 fresh schema 原则。
- **暂不建点数**（只留 CostReservation 护栏）。拒绝理由：产品上需要可见的点数/余额概念与扣费路径；Node-owned 账本以最小成本满足。
