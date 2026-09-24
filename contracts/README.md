# contracts/ — 跨进程契约

> **本目录是跨服务契约的**唯一权威**（ADR-0113 决策 8）。
> 契约中立后，任何服务换语言都只是重写实现，不改契约——这是多语言架构的护城河。

## 为什么不在 `backend/` 下

契约是**语言中立**的：`billing.proto` 同时被 TypeScript（business-api）和 Java（billing-svc）消费。
放 `backend/libs/contracts/` 会把 Java 侧的依赖指向 Node 应用目录。

> **注**：早期设计文档里写的是 `packages/contracts/`，但本仓**没有 `packages/`**，
> `pnpm-workspace.yaml` 只有 `backend` 一个成员。故落在顶层 `contracts/`，
> 与现有平铺结构（`backend/` · `web/` · `server/blue-whale-worker/`）一致，且不用动 workspace。

## 结构

```
contracts/
├── buf.yaml                    buf 配置（lint + breaking 规则）
├── buf.gen.yaml                代码生成配置
└── proto/
    ├── common/v1/types.proto       SpecAttrs · PageRequest/Response
    ├── billing/v1/billing.proto    ★ RPC 面：Hold · QueryBalance · ListTransactions
    ├── billing/v1/usage.proto      UsageLine（worker → billing，经 MQ）
    ├── billing/v1/events.proto     MQ 事件：job.completed/failed · catalog.activated
    └── identity/v1/identity.proto  VerifySession（应用层 Guard 调）
```

## 三条硬约定

### 1. 零浮点

| 类型 | 单位 | 例子 |
|---|---|---|
| 金额 | `int64` **mc**（微积分，1 积分 = 1000 mc） | `19000` = 19 积分 |
| 系数 | `int32` **万分比** | `9000` = 90% |
| 时间 | RFC3339 字符串（**带时区**） | `2026-09-24T14:22:01+08:00` |

### 2. RPC 面很小 —— **结算不走 RPC**

```
提交预扣  → 同步 gRPC（50ms 预算）      ← 唯一在用户等待路径上的
完成结算  → MQ 事件                     ← 异步，不阻塞
失败返还  → MQ 事件
余额查询  → gRPC（读）
价格预览  → 本地算，不 RPC
```

### 3. `usage` 维度枚举三方一致

`usage.proto` 的 `quantities` key、catalog 的 `baseUnit`/`dims`、
Java 侧 `QuantityRegistry` **必须是同一套值**。

这是「**配了某个维度但没人上报**」的结构性防线 —— 不是靠人检查。

## 生成

```bash
cd contracts
buf generate          # 需先装 buf：brew install bufbuild/buf/buf
```

**生成物不入仓**（避免 TS / Java 两端生成物漂移），构建时生成：

| 端 | 输出 |
|---|---|
| TypeScript | `backend/libs/contracts/gen/` |
| Java | `server/blue-whale-common/target/generated-sources/proto/`（**待 `java/` 落地后启用**） |

## 变更规则

| 规则 | 原因 |
|---|---|
| 字段**只加不删** | proto3 天然向前兼容 |
| 删字段用 `reserved` | 防字段号复用 |
| **CI 强制 breaking 检测** | `buf breaking --against '.git#branch=release/2026.09.29'` |
| **服务端先行** | 新字段服务端先支持，客户端再消费 |

## 关联文档

- [架构设计 §11 跨进程契约](../docs/specs/2026-09-24-用户与计费体系架构设计.md)
- [计费逻辑详细设计](../docs/specs/2026-09-24-计费逻辑详细设计.md)
- [核心流程数据流转](../docs/specs/2026-09-24-核心流程数据流转.md)
