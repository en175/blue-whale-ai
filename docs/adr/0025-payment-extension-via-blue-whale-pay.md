# 支付扩展：移植 jeepay 渠道核心重写 blue-whale-pay，Go 发起、Java 当通道

> **状态：Superseded** — 本 ADR 描述的是未落地的历史目标。支付不属于 IK3UUX，范围以
> [ADR-0055](0055-prelaunch-typescript-unification-scope.md) 为准；不得把本文或已取消的 IK3UWF 当作重构前置条件。

blue_whale_api（Go，new-api 二开）要加微信/支付宝充值。开源 jeepay（SpringBoot 3.3.7，强依赖 MQ）是成熟支付系统，但与 blue_whale_server（SpringBoot 2.7.7，无 MQ）技术栈断层。决定**不整体搬入 jeepay**，只移植其渠道支付核心（微信 weixin-java-pay / 支付宝 alipay-sdk-java 的下单、签名、回调验签），用 server 现有栈重写为 **blue-whale-pay** 微服务；充值由 **Go 发起、Java 当纯支付通道**，Go 仍是订单（`top_ups`）与 quota 账本的唯一权威。

## Considered Options

- **整体降级并入**：jeepay 降到 SB2.7.7 整套并进。风险高（jakarta→javax、binarywang SDK 兼容）、工作量大、jeepay 升级要自己 merge。
- **独立部署**：jeepay 保留 SB3.3.7 独立跑，Dubbo 暴露能力。两套 SB 版本 + 两套中间件（MySQL/Redis/MQ），技术栈不统一，与"统一微服务"定位冲突。
- **移植重写（选）**：避开版本断层与 MQ 强依赖，融入统一技术栈；代价是失去 jeepay 聚合收银台/分账/运营后台（需用时再重写）。

## Consequences

- 拿不到 jeepay 后续升级红利；聚合收银台、分账、多商户管理需自行实现。
- Go 充值链路复用现有 topup 框架（`top_ups` / `LockOrder` / `RecordTopupLog` / `getPayMoney`），一致性在 Go 内闭环，Java 职责单一（下单 + 验签 + 通知）。
- 支付成功回写经 Dubbo 调 Go `confirmTopUp`（订单级幂等守卫），不是裸 `IncreaseUserQuota`（后者非幂等，重复调会多加 quota）。
- 跨语言通道见 [ADR-0026](0026-java-go-dubbo-triple-rpc.md)。
