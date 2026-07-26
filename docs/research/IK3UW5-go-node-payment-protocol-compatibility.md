# Go 与 Node 支付通道协议兼容性研究

> **IK3UUX 范围状态**：Out of scope。本文仅作为未来支付工作研究记录；Go 支付代码、Node Payment
> Gateway、ConfirmTopUp 与渠道接入不属于当前重构，见
> [ADR-0055](../adr/0055-prelaunch-typescript-unification-scope.md)。

关联议题：[IK3UW5：评估 Go 与 Node 支付通道的协议兼容方案](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UW5)

## 结论

在“绝不修改 `blue_whale_api`”的硬约束下，Node.js **无法通过替换现有 Java Triple 服务接入**，因为仓库里目前没有已落地的 `blue-whale-pay`、共享 `.proto`、Go 侧 Dubbo/gRPC 服务或 `confirmTopUp`。现存的 Go↔支付通道契约不是 RPC，而是 Go 已实现的 Epay 表单跳转与异步通知协议。

因此：

1. **唯一能只靠配置接通的方案**：让 Node 实现一个 Epay 兼容网关，承接 `/submit.php`，对接微信/支付宝，再按 Epay 参数与 MD5 规则回调 Go。
2. **该方案不满足生产级普通充值账本可靠性**：Go 的普通 Epay 回调先向上游写出 `success`，再把订单改为成功，最后单独增加 quota；订单状态与 quota 不在同一事务。quota 更新失败后，重试会因订单已成功而跳过入账。
3. **推荐的目标协议**：如果后续允许对 Go 做最小修改，使用共享 Protobuf IDL + HTTP/2 标准 gRPC + unary 支付 RPC；Node 采用稳定的标准 gRPC 实现。不要把当前为 alpha、治理能力未完成的 Dubbo-JS 作为支付主链路默认依赖。

换言之，严格零改 Go 可以得到“协议接通”，但不能同时承诺“普通充值可靠入账”。这两个目标在当前实现下冲突。

## 当前真实边界

### Triple/proto 是目标决策，不是现存契约

[ADR-0025](../adr/0025-payment-extension-via-blue-whale-pay.md) 和 [ADR-0026](../adr/0026-java-go-dubbo-triple-rpc.md) 描述的是计划中的目标：Go 发起支付、Java 作为纯通道、Java 回调 Go 的 `confirmTopUp`，双方共享 `.proto` 并通过 Dubbo3 Triple 互通。

仓库现状与该目标之间仍有实现缺口：

- `blue_whale_api` 没有 `.proto`、`confirmTopUp`、dubbo-go 或直接 gRPC 依赖；`go.mod` 只有间接的 Protobuf 依赖，并固定使用 [`go-epay v0.0.4`](../../blue_whale_api/go.mod#L6-L8)。
- Java 侧只准备了 Dubbo 3.2.6、Triple 与 Nacos 依赖（[`pom.xml`](../../blue_whale_server/blue-whale-parent/blue-whale-common-tool/blue-whale-common-dubbo-rpc/pom.xml#L14-L40)），以及按接口名创建同步泛化消费者的 [`IDynamicDubbo`](../../blue_whale_server/blue-whale-parent/blue-whale-common-tool/blue-whale-common-dubbo-rpc/src/main/java/com/blue/whale/tool/dubbo/rpc/IDynamicDubbo.java#L21-L56)；没有支付业务 provider/consumer。
- 仓库中没有 `blue-whale-pay` 模块。

因此，当前不存在一个 Node 可以原样承接的 Go→Java 或 Java→Go Triple 地址、方法、消息结构、错误码和幂等语义。

### 现存可配置契约是 Epay

Go 已经提供了完整的 Epay 扩展点：

- 网关地址、商户 ID、密钥和支付方法是配置项；默认支付方法包含 `alipay`、`wxpay`（[`payment_setting_old.go`](../../blue_whale_api/setting/operation_setting/payment_setting_old.go#L12-L37)）。
- Go 在发起支付时创建自己的待支付 `top_ups` 订单，生成通知地址 `/api/user/epay/notify`，再由 `go-epay` 生成跳转 URL 与表单参数（[`topup.go`](../../blue_whale_api/controller/topup.go#L189-L265)）。
- 固定版本 `go-epay v0.0.4` 的 `Purchase` 使用 `{PayAddress}/submit.php`，参数包含 `pid`、`type`、`out_trade_no`、`notify_url`、`name`、`money`、`device`、`sign_type=MD5`、`return_url`、`sign`（[`go-epay order.go`](https://github.com/Calcium-Ion/go-epay/blob/v0.0.4/epay/order.go)）。
- Go 的通知端用同一商户密钥验签，要求 `TRADE_SUCCESS`，并校验订单的 `PaymentProvider` 为 `epay`（[`topup.go`](../../blue_whale_api/controller/topup.go#L310-L411)）。
- 支付能力还受合规确认开关约束（[`payment_setting.go`](../../blue_whale_api/setting/operation_setting/payment_setting.go#L16-L35)）。

实际调用方向如下：

```text
浏览器 / Next.js
    │ 1. POST /api/user/pay
    ▼
Go blue_whale_api ── 2. 返回 Epay URL + 已签名表单参数 ──► 浏览器
                                                          │
                                                          │ 3. POST Node /submit.php
                                                          ▼
                                               Node 支付兼容网关
                                                          │ 4. 调微信/支付宝
                                                          ▼
                                                  支付渠道 webhook
                                                          │
                                                          │ 5. Node 验签并转换
                                                          ▼
Go /api/user/epay/notify ◄── 6. Epay MD5 签名通知 ─────────┘
```

这是一条“浏览器跳转 + Node 回调 Go”的协议链，不是 Go 与 Node 之间的同步 Triple RPC。

## 方案评估

| 方案 | 零改 Go 可接通 | 账本可靠性 | 结论 |
| --- | --- | --- | --- |
| Node 原生实现 Dubbo Triple | 否 | 取决于新增的 Go 契约 | 当前 Go 没有 Triple 服务、共享 proto 或 `confirmTopUp`，无可替换端点 |
| 标准 gRPC（Node `grpc-js` / Go `grpc-go`） | 否 | 可设计为可靠 | 若放宽 Go 约束，这是首选目标方案 |
| Node Epay 兼容网关 | 是，只需配置 | 普通充值存在阻断级缺口 | 当前唯一可接通方案，只能作为受限过渡 |
| Node 直接写 Go 数据库 | 技术上可绕过 | 破坏账本所有权与演进边界 | 拒绝 |
| sidecar/协议转换层 | 否 | 不能修复 Go 内部事务 | 当前没有源 RPC 可转换，增加一层也无济于事 |

### Node Epay 兼容网关的最小职责

Node 只承担支付通道，不拥有 Go 的订单或 quota：

1. 暴露 `POST /submit.php`，按固定的 Epay 字段、排序和 MD5 规则验证 Go 生成的签名。
2. 将 `out_trade_no` 原样作为支付渠道侧幂等标识；金额、商户号、支付方式做严格白名单校验。
3. 调用微信/支付宝下单，保存“Go 单号 ↔ 渠道单号”的通道侧映射。
4. 验证微信/支付宝 webhook；只有渠道明确成功才生成 Epay `TRADE_SUCCESS` 通知。
5. 使用对应 Epay 商户密钥签名，向 Go 的 `notify_url` 发送表单通知；保留原始渠道事件以供审计。

Node 不应直接更新 `top_ups`、用户 quota 或订阅表，也不应自行推断 Go 已完成入账。

## 阻断与风险

### 普通充值回调不是原子操作

普通 Epay 回调在验签成功后，先向上游写出 `success`（[`topup.go`](../../blue_whale_api/controller/topup.go#L353-L371)），然后：

1. 把 `top_ups.status` 更新为成功；
2. 单独调用 `IncreaseUserQuota` 增加额度（[`topup.go`](../../blue_whale_api/controller/topup.go#L385-L405)）。

这两步不在同一个数据库事务中。若第 1 步成功、第 2 步失败：

- 上游已经收到 `success`，通常不会继续重试；
- 即使 Node 主动重试，Go 看到订单不再是 pending，也不会再次增加 quota；
- Node 不能仅凭 HTTP 200/`success` 证明用户额度已经入账；
- 进程内 `LockOrder` 不能提供多实例分布式互斥。

零改 Go 的适配层无法修复这个账本内一致性缺口；直接补写数据库又违反“Go 是账本唯一权威”的边界。

### 订阅 Epay 路径更可靠，但不能替代普通充值

订阅通知在验签和 `TRADE_SUCCESS` 检查后才调用 `CompleteSubscriptionOrder`，成功后再回复 `success`（[`subscription_payment_epay.go`](../../blue_whale_api/controller/subscription_payment_epay.go#L118-L168)）。`CompleteSubscriptionOrder` 在一个数据库事务中锁定订单、做成功幂等判断、创建订阅快照、补充值记录并更新订单（[`subscription.go`](../../blue_whale_api/model/subscription.go#L560-L632)）。

这说明 Go 已有可复用的正确模式，但普通充值路径尚未采用；Node 适配层不能把订阅事务语义移植到普通充值。

### Dubbo-JS 能调 Triple，不等于适合当前生产主链路

Apache Triple 包含两种不同模式：

- HTTP RPC：HTTP/1 或 HTTP/2，只支持 unary；
- 扩展 gRPC：HTTP/2，官方声明与标准 gRPC 线协议兼容。

标准 gRPC 客户端与 Triple 的互操作需要共享 Protobuf IDL；不能把 Triple 的 HTTP/1 JSON、Java interface wrapper 与标准 gRPC 混为一谈（[Triple 规范](https://dubbo.apache.org/en/overview/reference/protocols/triple-spec/)，[Dubbo 与标准 gRPC 互操作](https://dubbo.apache.org/en/overview/mannual/java-sdk/tasks/protocols/triple/grpc/)）。

Apache 官方 Node SDK 提供 Dubbo/Triple 和标准 gRPC transport，但其包仍标为 `3.0.0-alpha`，服务发现、负载均衡、路由、Token Filter、指标和追踪仍列为开发中（[`dubbo-node package.json`](https://github.com/apache/dubbo-js/blob/dubbo3/packages/dubbo-node/package.json)，[`dubbo-js` 能力状态](https://github.com/apache/dubbo-js/blob/dubbo3/README.md#service-governance-features)）。

因此：

- sidecar 不是 HTTP/2 标准 gRPC 互操作的协议必需品；
- 如果依赖 Nacos、Dubbo 路由、统一 mTLS、熔断或观测，必须由 Kubernetes Service、网关或 service mesh 补齐；
- 支付 RPC 应使用 unary、应用级幂等键和结果查询；超时不能等价为“操作未发生”（[gRPC 状态码语义](https://github.com/grpc/grpc/blob/master/doc/statuscodes.md)）。

## 推荐决策

### 在当前硬约束内

将 Node 支付服务定义为 **Epay 协议兼容网关**，而不是“Node 版 Dubbo `blue-whale-pay`”。这能在不改 Go 的前提下完成协议接线，适合联调或明确接受风险的受限过渡。

生产启用普通充值前必须把以下事项设为发布门禁：

- 明确接受“订单成功但 quota 未入账”的残余风险，或允许最小 Go 修复；
- 对 Node→Go 通知做故障注入，覆盖验签失败、重复通知、Go 进程退出、订单更新后 quota 更新失败；
- 建立账单对账与人工补偿流程，但不得让 Node 直接写 Go 账本。

### 若允许最小 Go 变更

目标边界应改为：

1. 共享 Protobuf IDL，支付调用固定使用 HTTP/2 标准 gRPC unary；
2. Go 暴露事务化、幂等的 `confirmTopUp` 或等价能力，订单状态与 quota 在同一事务提交；
3. Node 使用成熟的标准 gRPC server/client，不依赖 Dubbo-JS 的未完成治理能力；
4. 服务发现、TLS、健康检查和观测交给现有基础设施；只有确有 Dubbo 治理依赖时才增加适配层。

这一目标与 ADR-0025 的“Go 是订单与 quota 唯一权威”一致，但需要明确放宽“绝不修改 Go”。

## 对 Wayfinder 地图的影响

- 不新增研究票：现有后续票“确定 Node 支付通道与 Go 的稳定边界”应消费本结论。
- 不新增 fog：关键未知不是技术可行性，而是产品/架构是否接受零改 Go 带来的普通充值可靠性缺口。
- 后续 grilling 必须在两个互斥选择中作决定：
  - 保持零改 Go，采用 Epay 兼容网关并显式接受受限可靠性；
  - 放宽为最小 Go 变更，采用事务化确认能力与标准 gRPC 目标边界。

## 核验范围

- 仓库源代码、`go.mod`、Java Dubbo 工具模块及 ADR-0025/0026。
- Apache Dubbo Triple 规范、Dubbo 与标准 gRPC 互操作文档、Apache Dubbo-JS 仓库。
- 项目固定的 `go-epay v0.0.4` 源码。

本研究没有修改业务代码，也没有执行支付联调。Epay 网关的逐字节签名兼容、支付渠道沙箱回调和故障注入仍属于后续原型/实现验证。
