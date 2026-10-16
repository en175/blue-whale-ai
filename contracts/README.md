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
    ├── billing/v1/billing.proto    ★ RPC 面：Charge · QueryBalance · ListTransactions
    ├── billing/v1/events.proto     MQ 事件：job.failed · catalog.activated
    └── identity/v1/identity.proto  VerifySession（应用层 Guard 调）
```

## 三条硬约定

### 1. 零浮点

| 类型 | 单位 | 例子 |
|---|---|---|
| 金额 | `int64` **mc**（微积分，1 积分 = 1000 mc） | `19000` = 19 积分 |
| 系数 | `int32` **万分比** | `9000` = 90% |
| 时间 | RFC3339 字符串（**带时区**） | `2026-09-24T14:22:01+08:00` |

### 2. RPC 面很小 —— **只有扣款在用户等待路径上**

```
提交扣款  → 同步 gRPC（50ms 预算）      ← 唯一在用户等待路径上的，扣的就是最终金额
成功      → 没有账务动作（ADR-0127）
失败返还  → MQ 事件                     ← 异步，不阻塞
余额查询  → gRPC（读）
价格预览  → 本地算，不 RPC
```

### 3. `usage` 维度枚举两方一致

catalog 规则里 `baseUnit` / `dims` / `multipliers` 用的 key，
与 Java 侧 `UsageDim` 的枚举值 **必须是同一套**（`usage.seconds`、
`usage.characters`、`usage.referenceSeconds`、`usage.referenceCount`…）。

这是「**配了某个维度但没人产出**」的结构性防线 —— 不是靠人检查。

| 事件 | topic（代码默认值） | 消费方动作 |
|---|---|---|
| `JobTerminalEvent` | `generation-job-terminal` | billing → **仅当消息里的 `refund=true`** 才全额返还 |
| `CatalogActivated` | `pricing.catalog.activated` | 各服务重载内存副本（生产者尚未落地） |

**一个 job 只发一条终态消息**：成功 / 失败 / 取消都发，消息带 `status` 与 `refund`。
`refund` 由**生产端**按真实结果判定，消费端照着做、不再从 `status` 推导：
失败退、未派发上游的取消退、**已派发上游的取消不退**（上游可能已经做成）、成功不退（扣款在提交时已完成，ADR-0127）。

⚠️ `generation-job-terminal` 是**新 topic**，broker 上不存在时 billing 的 push consumer 起不来（订阅一个无路由的 topic 会直接抛错），
部署前须先在 broker 上建好。

## 取消任务的计费查询

IKM12Y 复用 `BillingService.ListTransactions`，由 backend 传入已校验归属的用户与任务 ID，读取计费主库已提交的状态，不缓存、不回写任务扩展表。`UserTransaction.charge_state` 使用新字段号 12，消费行取 `billing_cost_reservations.status`，值为 `charged` 或 `refunded`；非消费行和旧服务返回空字符串。`status=done` 只表示流水状态，金额为零也不能替代退款状态。

`GET /api/jobs/:id` 与用户任务列表对 `cancelled` 的 `sample`、`final` 视频任务使用此字段。退款事务提交后，下一次成功读取计费主库的请求即收敛为 `refunded`；事务提交前读取仍为 `charged`。查询超时预算为 1 秒，接口不可用、缺少流水、字段为空或无法识别时返回 `charge_state=null`，表示未确认，不使用任务扩展表的陈旧值。任务状态仍为 `cancelled`，普通任务和其他状态保持原有语义。列表每批最多查询 100 个任务。

本次只改变状态来源，`actual_credits` 保持原有语义。查询不触发扣款或退款。重复、迟到的终态消息继续由现有退款事务与幂等约束处理，查询端没有可被旧结果覆盖的持久缓存。先部署支持字段 12 的计费服务，再部署消费者；旧计费服务期间返回未确认状态。

## 生成

```bash
cd contracts
buf generate          # 需先装 buf：brew install bufbuild/buf/buf
```

**生成物不入仓**（避免 TS / Java 两端生成物漂移），构建时生成：
TS 端必须带 `import_extension=js`（见 `buf.gen.yaml`）——本仓 tsconfig 是 node16/nodenext 解析，裸相对导入会报 TS2835。

| 端 | 输出 |
|---|---|
| TypeScript | `backend/libs/contracts/gen/` |
| Java | `server/blue-whale-common/target/generated-sources/proto/`（**待 `java/` 落地后启用**） |

## 变更规则

| 规则 | 原因 |
|---|---|
| 删字段**必须 `reserved` 号与名** | 防字段号复用 —— 那才是真正的危险（新旧两端静默读错位） |
| 没用了的字段**删掉**，不要留成 `deprecated` 死字段 | 一个没有读者的字段留在契约里，下一个人会把它当活契约用 |
| 不能原地改类型 / 改字段号 | 同一号码上换类型，滚动发布期间老的一侧会解出错值。要改就换新号 |
| **CI 强制 breaking 检测** | `buf breaking --against '.git#branch=release/2026.09.29'`，规则集 `WIRE`（见 `buf.yaml` 里为什么由 `FILE` 改过来） |
| **服务端先行** | 新字段服务端先支持，客户端再消费 |

`ListTransactionsRequest` 为旧的单值 `type_filter` 保留字段号 `2` 和名称，新版 `type_filters` 使用字段号 `4` 的 `repeated string`。`AdminListTransactionsRequest` 为旧的 `page_token` 保留字段号 `4` 和名称，当前页码 `page` 使用字段号 `5`。这些形状可在 `billing/v1/billing.proto` 核对，兼容性决策沿用上面的字段保留规则。

## 关联文档

- [架构设计 §11 跨进程契约](../docs/specs/2026-09-24-用户与计费体系架构设计.md)
- [计费逻辑详细设计](../docs/specs/2026-09-24-计费逻辑详细设计.md)
- [核心流程数据流转](../docs/specs/2026-09-24-核心流程数据流转.md)
