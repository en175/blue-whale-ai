# IK50GB 认证用户上下文与 Java 断链设计

- 状态：已确认
- 日期：2026-07-29
- 工单：IK50GB
- 采用方案：方案 A——集中式 `getAuthenticatedUser()` 深模块
- 上游决策：[ADR-0059](../adr/0059-business-api-into-nextjs-route-handlers.md)、[ADR-0062](../adr/0062-new-api-account-center-and-quota-billing.md)
- 研究依据：[IK50GB 深度调研](../research/2026-07-29-ik50gb-authenticated-user-context.md)

## 1. 目标

BlueWhale 只接受 new-api 签发的 `sk-xxx` 作为首版浏览器凭证。Next.js Product API 从
new-api 身份解析接口取得稳定 User ID，构建统一的认证用户上下文，并将该 User ID 用于
Project、Canvas、Asset、Conversation、AgentRun、GenerationJob 等全部产品事实的归属和授权。

目标请求链只有：

```text
Browser
  └─ Authorization: Bearer sk-xxx
       └─ Next.js Route Handler
            └─ getAuthenticatedUser()
                 └─ new-api GET /api/token/identity
                      └─ stable new-api User ID
```

Java Gateway、Java User Service 和 Java Product API 不再位于公开账户或产品请求链。迁移不建设
Java JWT 兼容、`sk-xxx` 到 Java 的代理、双身份映射或浏览器 `X-User-Id` 兜底。

## 2. 非目标

- 本设计不把 `sk-xxx` 从 `localStorage` 迁移到 HttpOnly Cookie。
- 本设计不建设 API Key 管理、管理员用户管理或复杂账户设置 UI。
- 本设计不集成手机号登录/换绑、OAuth、Passkey 或 2FA。
- 本设计不迁移生产 User 或回填旧 Java User；当前没有生产 User。
- 本设计不让 webhook 使用 User Context；机器回调使用独立真实性验证。

## 3. 核心模块

### 3.1 对 Route Handler 的接口

Route Handler 只依赖以下语义接口：

```ts
type AuthenticatedUser = {
  userId: string;
  status: "enabled";
};

type AuthenticationPolicy = "ordinary" | "fresh";

getAuthenticatedUser(
  request: Request,
  options?: { policy?: AuthenticationPolicy },
): Promise<AuthenticatedUser>;
```

- `ordinary` 是受保护产品接口的默认策略，允许读取未过期的 60 秒缓存。
- `fresh` 用于 `/api/me`、账户安全与管理员操作，每次实时查询 new-api。
- Route Handler 只能读取 `userId`，不得取得原始 Token、摘要、上游状态数字或缓存对象。
- 认证失败抛出统一 typed error，不再以 `null` 折叠所有失败。

### 3.2 内部依赖

认证模块依赖一个最小 port：

```ts
interface IdentityResolver {
  resolveTokenIdentity(token: string): Promise<{
    userId: number;
    status: number;
  }>;
}
```

生产 adapter 复用现有 `AccountClient.resolveTokenIdentity()`；测试使用 in-memory resolver。缓存、
时钟、摘要函数和并发去重均封装在认证模块内部，通过 factory 注入以支持确定性测试。

### 3.3 凭证解析

- 只接受严格的 `Authorization: Bearer sk-xxx`。
- 缺失 Bearer、空 Token、非 `sk-xxx` 和旧 Java JWT 全部返回 `401`，且不调用上游。
- 浏览器提交的 `user_id`、`userId`、owner 字段和 `X-User-Id` 全部不参与身份或授权。
- Token 仅在当前请求和调用 new-api 所需的内存生命周期内存在，不进入日志、错误或缓存。

## 4. 有界身份缓存

缓存 key 是完整 Token 的 SHA-256 摘要；摘要只用于定位缓存项，绝不作为产品 owner。

缓存 value 只包含：

```ts
{
  userId: string;
  status: "enabled";
  expiresAt: number;
}
```

规则如下：

1. 成功验证后写入，绝对 TTL 不超过 `60_000ms`；命中不续期。
2. `now >= expiresAt` 视为过期，先删除再实时验证；不得读取 stale。
3. 缓存具有固定 `maxEntries`，采用 LRU 或等价确定性驱逐策略。
4. `401/403` 立即驱逐对应摘要；不做负缓存。
5. miss、expired 或 `fresh` 请求遇到 `502/503` 时失败关闭；普通请求已有有效命中时可继续使用。

缓存是单 Node 进程优化，不提供跨实例一致性。封禁最多延迟 60 秒生效是已接受的首版取舍；安全和
管理员操作通过 `fresh` 消除此延迟。

## 5. 错误合同

认证模块保留故障类型，Route Handler 使用同一个响应映射：

| 场景                               | HTTP | 语义             |
| ---------------------------------- | ---- | ---------------- |
| 缺失、格式错误、无效或已删除 Token | 401  | 登录凭证无效     |
| User 已禁用                        | 403  | 账户已停用       |
| new-api 返回畸形或非合同响应       | 502  | 账户服务响应异常 |
| new-api 连接失败或超时             | 503  | 账户服务暂不可用 |

不得把 `502/503` 转成 `401`，否则上游故障会被伪装成登录过期。错误响应不得包含 Token、摘要、
new-api 内部地址、HTML、堆栈或上游原始响应。

## 6. 产品接口迁移与 Java 断链

### 6.1 已在 Next.js 的接口

现有 26 个受保护 Route Handler 一次性从 `getUserIdFromRequest(request, JWT_SECRET)` 迁到
`getAuthenticatedUser(request)`：

- Project、Canvas、Asset 与上传；
- GenerationJob、Job 与模型能力；
- Skill 与 Template；
- Snapshot 与 Project Asset。

迁移同时删除 Token 指纹 owner、Java JWT fallback、Route Handler 级 `JWT_SECRET` 和浏览器
`X-User-Id` 注入。

### 6.2 IK50GB-B 剩余产品接口处置

以下产品能力迁到 Next.js/TypeScript：

- `/api/generation-inbox/**`
- `/api/projects/*/conversation/**`
- `/api/projects/*/events`

UserInputRequest 只保留通过 Conversation 消息的
`reply_to_input_request_id` 回答语义，不迁移独立 confirm 接口。AgentRun 改为 TypeScript
Worker 直接通过共享应用/持久化层 claim/commit，不迁移 Java HTTP 控制接口。按 Job 的内存 SSE
没有浏览器消费者且不可重放，直接退役；浏览器只使用持久 Project SSE。

迁移必须复用 `packages/core` 与 `packages/persistence` 的领域和持久化模块，不在 Route Handler
重写第二套业务规则。SSE 保留所有权校验、游标恢复、禁止缓冲和断线清理语义。

### 6.3 非产品 rewrite

- `/api/user/**`：随旧账户语义退役，不迁移为 Java 兼容入口。
- `/api/webhooks/**`：迁到 TypeScript 后采用机器回调签名/密钥验证，不调用
  `getAuthenticatedUser()`。
- `/assets/**`：完成 Asset 传输链迁移后删除 Gateway rewrite，访问授权仍由 Product API 决定。

### 6.4 断链完成条件

同时满足以下条件才可宣告 Java 断链：

1. 浏览器和 Next.js 不再请求 `GATEWAY_URL` 或 Java 服务地址。
2. `next.config.ts` 不再存在 Java 产品、账户或 Asset rewrite。
3. 受保护产品路由不再导入 Java JWT、`JWT_SECRET`、`X-User-Id` 或 Token 指纹 owner。
4. BlueWhale 核心本地验收不启动 `blue_whale_server` 仍可完成登录、产品读写、对话和生成。
5. 仓库静态守卫阻止重新引入 Java 产品 rewrite 和旧认证 helper。

删除 Java 源码或部署资产可以作为独立清理提交，但运行时断链必须在 IK50GB 完成前成立。

## 7. 实施切片

### IK50GB-A：认证内核

- 实现方案 A 深模块、错误分类和 60 秒有界缓存。
- 迁移 26 个现有 Next.js 产品路由。
- 删除 Token 指纹、Java JWT fallback 和浏览器 `X-User-Id`。

### IK50GB-B：剩余产品 API 迁移

- 迁移 GenerationInbox、Conversation、Conversation 内 InputRequest 回复、持久 AgentRun Worker
  与 Project SSE；退役独立 InputRequest confirm、AgentRun HTTP 和 Job SSE。
- 补齐缺失的 TypeScript Conversation、AgentRun 与事件持久化/应用用例。
- 每一类接口使用同一个认证用户上下文。

### IK50GB-C：Java 断链与真实验收

- 删除产品、账户和 Asset Java rewrites。
- 更新本地运行拓扑，不启动 Java Gateway/User/Agent。
- 运行 BlueWhale → real new-api 的登录、身份、quota、产品读写与生成 smoke。
- 在 A、B、C 全部通过前不关闭 IK50GB。

三个切片串行执行；不得用临时 Node→Java adapter、双 JWT 或兼容开关跨过 B。

## 8. 测试设计

### 8.1 认证模块

- 缺失/非 `sk-xxx`/旧 Java JWT 返回 `401`，且 resolver 未调用。
- 两把属于同一 new-api User 的 Token 得到相同 owner。
- hit、miss、恰好 60 秒过期、命中不续期和 `maxEntries` 驱逐。
- `401/403` 驱逐、disabled fail closed、`fresh` 绕过缓存。
- `502/503/timeout` 在 miss/expired 时失败关闭，绝不使用 stale。
- 并发 miss 去重不泄漏 Token；缓存、日志和错误中不存在 `sk-`。

### 8.2 产品接口

- 代表性读、写、删除和 SSE 路由把 `context.userId` 传给领域层。
- 请求伪造 `user_id`、owner 或 `X-User-Id` 不改变授权结果。
- 跨 User 访问 Project、Asset、Conversation 和 Job 继续返回不泄漏存在性的资源错误。
- 受保护路由登记测试确保新增 Route Handler 不绕过认证 seam。
- 静态测试确保 Java rewrite、旧 helper 和 Java JWT import 数量为零。

### 8.3 真实链路

真实本地验收至少覆盖：

```text
register → auto-login → me → quota
        → create/list Project
        → Conversation/GenerationInbox
        → create GenerationJob
        → observe SSE/result
```

验收只启动 Next.js、TypeScript workers、new-api、MySQL/Redis 和必要对象存储依赖；不启动 Java。
只有 mock 测试通过不能完成 IK50GB。

## 9. 文档对齐

- ADR-0062 明确 Java rewrite 是待删除迁移缺口，不是允许长期保留的目标架构。
- ADR-0057、ADR-0060 标记为 Superseded，并链接 ADR-0062。
- ADR-0018 的手机号、refresh、Java Product API 身份部分由 ADR-0062 和本设计取代；其对象授权、
  审核、成本与审计原则继续有效。
- 账户 BFF Spec 增加受保护路由登记、`fresh` 实例、Java 断链条件与真实无 Java 验收。
- 历史 PRD/实施记录保留原文追溯，但增加“历史基线/已被取代”标识。
- 部署和运行文档在对应实现切片完成时同步，不能提前把尚未可运行的命令写成现状。

## 10. 完成定义

IK50GB 完成时：

- 每个产品事实只引用稳定 new-api User ID；
- Token 轮换不改变产品归属；
- 所有产品接口共享方案 A；
- 认证缓存、错误和敏感信息边界通过测试；
- Java JWT、浏览器身份头和 Token 指纹不再参与运行；
- 核心 BlueWhale 链路在完全不启动 Java 的环境中通过真实验收。
