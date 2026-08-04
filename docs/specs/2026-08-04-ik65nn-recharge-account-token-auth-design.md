# IK65NN 充值账户凭证统一设计

- 状态：已确认
- 日期：2026-08-04
- 工单：IK65NN
- 上游决策：[ADR-0062](../../adr/0062-new-api-account-center-and-quota-billing.md)

## 目标

BlueWhale 浏览器、Next.js BFF 与 new-api 充值链路统一使用用户默认 `sk-xxx`。充值报价、下单和查单
按 Token 属主记录真实用户，不再由 `NEW_API_ROOT_ACCESS_TOKEN` 代表全部用户操作。

## 核心设计

new-api 将“Token 证明账户身份”和“Token 是否有资格调用模型”拆成两个授权层：

1. `AccountTokenAuth` 是账户层。它验证 Token 真实存在、未显式禁用、未到期且所属 User 启用，
   然后向 Gin Context 注入 `id`、`token_id` 和 `token_key`。它不检查 Token 的剩余调用额度、
   IP、模型或分组限制，因此额度耗尽的 User 仍可充值和查看自己的订单。
2. `TokenAuth` 继续作为 relay 层，保留现有状态、额度、IP、模型和分组校验。模型、图片和视频
   调用不降低安全策略。
3. new-api 原生控制台仍可通过 session 使用充值接口；BlueWhale BFF 通过 `sk-xxx` 使用同一组
   控制器。路由采用只为账户接口设计的 `AccountTokenOrUserAuth`，不改变现有媒体
   `TokenOrUserAuth` 的严格 relay 语义。
4. `GET /api/token/identity` 复用账户 Token 校验规则，避免 BFF 登录态因为 Token 调用额度耗尽
   而失效。

“调用额度耗尽”可继续证明 Token 属主；“显式禁用”和“到期”属于凭证失效，必须返回 `401`；
User 禁用返回 `403`；数据库故障返回 `500/502` 对应的稳定上游错误。

## 请求链

```text
Browser Authorization: Bearer sk-xxx
  -> Next.js withAuthenticatedUser
  -> new-api AccountTokenAuth
  -> token.UserId
  -> RequestAmount / RequestBlueWhalePayPay / GetUserTopUps
```

浏览器提交的 User ID 与 `New-Api-User` 均不参与 BlueWhale 身份判定。Next.js 从当前请求提取已经
由 `withAuthenticatedUser` 真校验过的 Token，并将同一 Token 转发给 new-api。

## Web 改动

- `go-topup.ts` 只解析 `NEW_API_BASE_URL`，删除充值路径对 root Token 和 root User ID 的依赖。
- 下单与查单 Route Handler 在认证回调内提取当前 Bearer Token，并传给 typed client。
- typed client 的三个原生充值方法删除 `userId` 参数，不再发送 `New-Api-User`。
- root 环境变量仍可由 `go-amount-discount.ts` 用于真正的 Root 管理接口，本工单不删除管理端能力。

## 安全边界

- Token 不进入日志、响应或持久化订单字段。
- 订单 User ID 只能来自 Go 验证后的 `token.UserId`。
- 查单查询继续以 Context User ID 过滤，不能跨 User 枚举订单。
- 充值写接口保留 `CriticalRateLimit`。
- 不让 `UserAuth` 双认 `sk-xxx`，避免在旧 access token 中间件内维护两套解析路径。

## 测试

- Go model/middleware：启用和耗尽 Token 可建立账户身份；禁用、到期、无效 Token 被拒绝；
  禁用 User 被拒绝；严格 `TokenAuth` 对耗尽 Token 的拒绝行为保持不变。
- Go controller/router：identity 在耗尽 Token 下仍解析稳定 User；充值路由用 Token 属主建立订单。
- TypeScript core：三个充值请求只发送 Bearer `sk-xxx`，不发送 `New-Api-User`。
- Next.js：下单、查单使用请求 Token；缺少 `NEW_API_BASE_URL` 返回 `503`；不再读取充值 root env。
- 全量运行 Go 范围测试、Web 测试和 TypeScript typecheck。

## 非目标

- 不修改 API Key 管理 UI、管理员用户管理或复杂账户配置。
- 不移除管理端折扣同步所需的 RootAuth 凭证。
- 不改变 Token 在浏览器 localStorage 的第一版存储方案。
- 不修改支付回调验签和加额度事务。
