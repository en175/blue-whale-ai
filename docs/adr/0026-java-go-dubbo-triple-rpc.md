# java<>go 统一 RPC：Dubbo3 Triple + dubbo-go

> **状态：Superseded** — 本 ADR 描述的是未落地的历史目标；当前支付边界以 [确定 Node 支付通道与 Go 的稳定边界](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK3UWF) 为准。

blue_whale_server（Java 微服务）与 blue_whale_api（Go）当前完全不互通（独立 DB、无互调、路径前缀 `/api/user` `/api/agent` 两边都有）。决定用 **Dubbo3 Triple + dubbo-go** 建立跨语言 RPC：Java 与 Go 注册到同一 Nacos，共享 `.proto` 契约，走 Triple（HTTP/2 + protobuf）；顺带启用 Java 侧 parent 已备但业务零使用的 Dubbo（`blue-whale-common-dubbo-rpc`）。

## Considered Options

- **网关 HTTP 路由**：blue-whale-gateway 加 Go 路由，同步 HTTP+JSON。最轻、最贴现状（Java 服务间本就走网关 HTTP），但无服务级 IDL 契约，调用多了靠约定。
- **gRPC 直连**：跨语言标准、有契约，但与已备 Dubbo Triple 成两套体系（Triple 本身基于 gRPC），多一种 server 运维。
- **dubbo-go + Triple（选）**：复用 Java 侧已备 Dubbo 工具件，统一服务发现/治理，为系统级 java<>go 互通（不止支付）打地基。

## Consequences

- dubbo-go 在 Go 生态相对小众，联调与运维成本需评估；Go 侧引入 dubbo-go + 定义 `.proto`。
- 需维护共享 `.proto` 契约；Java 内部服务间 Dubbo 顺势启用，从"备而不用"转为"统一 RPC"。
- 用户体系统一（Java user 直连 Go users 表）是独立需求，本决策不覆盖身份对齐，支付设计假设 `goUserId` 可获取。
