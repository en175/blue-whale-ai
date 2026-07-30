# IK50GB：统一认证用户上下文深度调研

- 日期：2026-07-29
- 工单：IK50GB
- 一手来源：仓库源码、[账户 BFF Spec](../specs/2026-07-29-new-api-account-bff-spec.md)、[ADR-0062](../adr/0062-new-api-account-center-and-quota-billing.md)
- 结论：采用方案 A，但不能把工作收窄成替换一个 helper；26 个 Next route 和仍经 8 个 Java rewrite 前缀暴露的产品路径必须一起收口。

## 结论

1. **Java 账户兼容应完全删除。** 产品接口只接受 `Authorization: Bearer sk-xxx`；旧 Java JWT、手机号、SMS、refresh token 和客户端 `X-User-Id` 都不构成兼容面。
2. **当前 owner 算法错误。** `sk-xxx` 被截断 SHA-256 映射成 BIGINT，换 Key 即换 owner；同一 helper 又回退验证 Java HS256 JWT（`blue_whale_web/lib/auth/user-from-request.ts:1-25`）。
3. **new-api 已有正确身份源。** Go 已挂载 `GET /api/token/identity`，返回稳定 User ID 和状态；typed client 已有 `resolveTokenIdentity`（`blue_whale_api/router/api-router.go:236`；`blue_whale_api/controller/user.go:321-350`；`packages/core/src/new-api-client.ts:276-301`）。
4. **方案 A 尚未实现。** `blue_whale_web/lib/account/bff.ts:12-50` 只有 client、Bearer 解析和错误映射，没有统一 Authenticated User Context、60 秒缓存或驱逐。
5. **Java rewrite 是独立阻塞面。** 浏览器改传 `sk-xxx` 后，Java Gateway 仍只接受旧 JWT；Conversation、GenerationInbox、SSE 等路径会在到达 controller 前返回 `401`。

## 方案 A：统一认证深模块

route 只依赖一个接口：

```ts
type AuthenticatedUser = { userId: string; status: "enabled" };

getAuthenticatedUser(
  request: Request,
  options?: { cachePolicy?: "ordinary" | "fresh" },
): Promise<AuthenticatedUser>;
```

- `ordinary`：普通产品 route 默认策略，可使用最长 60 秒缓存。
- `fresh`：`/api/me`、账户安全和管理员操作，始终实时调用 new-api。
- 只接受 `Bearer sk-xxx`；缺失、其他 Bearer（含旧 JWT）和无效 Token 返回 `401`。
- new-api User 禁用返回 `403`，合同异常返回 `502`，连接失败或超时返回 `503`。
- route 只读取 `context.userId`；Token、摘要、TTL、状态码和 new-api 路径留在模块内部。

缓存边界：

- Key 是完整 Token 的 SHA-256 摘要；摘要只索引缓存，绝不作为 owner。
- Value 仅 `{userId,status,verifiedAt,expiresAt}`，不保存明文 Token、用户名、邮箱或 quota。
- TTL 绝对最多 `60_000ms`，命中不续期；还需 `maxEntries` 和 LRU/等价容量驱逐。
- `401/403` 立即删除对应项；不负缓存。
- miss、expired、fresh 遇到 `502/503` 时失败关闭；有效未过期缓存可继续使用，过期值永不复用。
- 当前 client 只验证 `status` 是 number（`packages/core/src/new-api-client.ts:282-301`）；深模块还应 fail closed，只接受 enabled。

## 26 个 Next route

仓库有 26 个 route 文件、30 次 `getUserIdFromRequest` 调用，且每个文件重复读取 `JWT_SECRET`。调用面如下：

| 产品域 | route 文件 |
|---|---|
| Project | `app/api/projects/route.ts:15,22`；`app/api/projects/[id]/route.ts:19,29,40`；`app/api/projects/[id]/snapshot/route.ts:18` |
| Canvas | `app/api/canvases/route.ts:10`；`app/api/canvases/[projectId]/route.ts:13` |
| Asset | `app/api/assets/route.ts:10`；`app/api/assets/[assetId]/route.ts:15`；`app/api/projects/[id]/assets/route.ts:14`；`app/api/projects/[id]/assets/[assetId]/route.ts:14`；`app/api/projects/[id]/assets/[assetId]/content/route.ts:14` |
| Agent Asset | `app/api/agent/assets/presign/route.ts:15`；`app/api/agent/assets/uploads/presign/route.ts:15`；`app/api/agent/assets/uploads/complete/route.ts:15`；`app/api/agent/assets/[assetId]/route.ts:15`；`app/api/agent/assets/[assetId]/complete/route.ts:13` |
| Job | `app/api/projects/[id]/generation-jobs/route.ts:22`；`app/api/projects/[id]/generation-jobs/[jobId]/cancel/route.ts:13`；`app/api/jobs/route.ts:10`；`app/api/jobs/[id]/route.ts:13`；`app/api/generation/models/route.ts:10` |
| Skill/Template | `app/api/agent/skills/library/route.ts:10`；`app/api/agent/skills/library/[id]/add/route.ts:13`；`app/api/agent/skills/mine/route.ts:10`；`app/api/agent/skills/mine/[id]/route.ts:13,24`；`app/api/agent/templates/page/route.ts:10`；`app/api/agent/templates/tags/route.ts:9` |

以上路径均位于 `blue_whale_web/`。它们已把服务端取得的 `userId` 传给领域 handler，所以主要改动应集中在认证 seam；迁移必须一次完成，不能让新旧认证并存。

`GET /api/me` 已直接调用 `resolveTokenIdentity`，是 `fresh` 策略的正确雏形（`blue_whale_web/app/api/me/route.ts:9-34`）。`GET /api/usage/token` 直接按 Token 查询上游 quota，不需要用 owner 反查 Key（`blue_whale_web/app/api/usage/token/route.ts:8-28`）。

## 8 个 Java rewrite 前缀

`blue_whale_web/next.config.ts:34-60` 仍代理以下前缀：

| rewrite 前缀 | 处理决定 |
|---|---|
| `/api/agent/runs/:path*` | 活跃产品读写，迁到 Node 并接方案 A |
| `/api/generation-inbox/:path*` | Conversation/GenerationJob 产品事实，迁到 Node |
| `/api/webhooks/:path*` | 机器回调，使用独立 webhook authenticity，不套 User Context |
| `/api/user/:path*` | 旧 Java Account，直接退役 |
| `/api/jobs/:path*/stream` | Job SSE，迁到 Node 并按稳定 User ID 授权 |
| `/api/projects/:path*/conversation/:path*` | Conversation 产品事实，迁到 Node |
| `/api/projects/:path*/input-requests/:path*` | Agent/Conversation 写入，迁到 Node |
| `/api/projects/:path*/events` | Project SSE，迁到 Node |

活跃证据包括 `blue_whale_web/lib/generation-inbox.ts:45-93`、`blue_whale_web/lib/conversation.ts:19`、`blue_whale_web/lib/project-recovery.ts:641` 和 `blue_whale_web/components/api/skills.ts:114`。Java Gateway 只验 HS256 JWT 并覆盖 `X-User-Id`（`blue_whale_server/blue-whale-gateway/src/main/java/com/blue/whale/gateway/auth/JwtAuthGlobalFilter.java:29-50,67-97`），因此不能通过让 Java 再兼容 `sk-xxx` 完成 IK50GB。

若迁移容量不足，剩余产品路径必须成为显式阻塞票。唯一可控的短期过渡是受信任 Node BFF 先按方案 A 解析身份，再由内部 adapter 覆盖 `X-User-Id`；它必须枚举路径、剥离客户端身份头、支持 SSE，并写明删除条件。该过渡不是 Java 账户兼容，也不是目标架构。

## 账户与身份遗留

- SMS route 和本地 users/SMS/JWT 依赖仍活跃：`blue_whale_web/app/api/auth/send-code/route.ts:1-9`、`blue_whale_web/lib/auth/deps.ts:1-32`。
- 前端仍暴露短信登录、refresh 和手机号换绑：`blue_whale_web/lib/auth.ts:14-23,95-154,172-225`。
- storage 仍保存 `bw-refresh-token`：`blue_whale_web/components/auth/authStorage.ts:3-5,83-113`。
- BFF 仍伪造 `refresh_token:""` 和 `phone:""` 兼容旧 shape：`blue_whale_web/lib/account/bff.ts:53-67`。
- 匿名 client 仍生成并发送 `X-User-Id`：`blue_whale_web/lib/api/client.ts:1-18,67-75`、`blue_whale_web/lib/api/userId.ts:1-14,36-53`。
- Generation credential encryption 仍以 `JWT_SECRET` 兜底，应只认 `GENERATION_CREDENTIAL_SECRET`（`blue_whale_web/workers/generation-worker.ts:32-35`；`apps/generation-worker/src/index.ts:43-49`）。

旧 fixture、测试和 UI 也应替换而非保留兼容分支。深模块测试至少覆盖：旧 JWT `401`、两把 Token 同一 owner、60 秒边界、容量驱逐、`fresh` bypass、`401/403` 驱逐、`502/503` fail closed、伪造 User ID 无效，以及日志中无 `sk-`。

## 文档漂移

1. `docs/adr/0062-new-api-account-center-and-quota-billing.md:71` 仍说保留旧手机号验证码用例；`:78` 仍说 mock new-api 且不修改 Go；两处与同 ADR `:19-21,34-37,61-64` 及 Spec 冲突。
2. 同 ADR `:11,73` 仍把 Java MCP/遗留运行时作为目标链路；若 Java 整体退役，应改成迁移现状说明。
3. Spec `docs/specs/2026-07-29-new-api-account-bff-spec.md:37,118` 的 “refresh persistence” 应改成 “browser reload persistence”；`:59,117` 应明确 `/api/me` 使用 `fresh`。
4. `docs/adr/0057-node-user-identity-and-credits-ledger.md` 与 `docs/adr/0060-node-user-identity-and-credits-ledger.md` 仍标 Accepted，却定义 Node users/JWT/X-User-Id/credits；两者都应标 Superseded 并链接 ADR-0062。
5. ADR-0018、积分讨论、旧工单/PRD 和本地部署文档仍把 Java、手机号、双 Token 或 `X-User-Id` 写成目标，应加 supersession banner 或同步更新。

## 建议拆分

1. **IK50GB-A：认证深模块。** 实现方案 A、60 秒有界缓存、错误分类和完整模块测试。
2. **IK50GB-B：Node route 迁移。** 一次性迁移 26 个 route，删除 route 级 `JWT_SECRET`、指纹 owner 和 Java JWT fallback。
3. **IK50GB-C：账户遗留清理。** 删除 SMS/refresh/phone/X-User-Id 运行路径、旧 UI/fixture/export，并解耦 Generation credential secret。
4. **IK50GB-D：Java rewrite 收口。** 产品路径迁 Node，`/api/user/*` 退役，webhook 独立认证；未完成项作为 IK50GB 验收阻塞。
5. **IK50GB-E：文档与真实联调。** 更新 ADR 状态、旧 PRD banner、部署说明和代码注释；完成 register→login→me→quota→产品写入 smoke。
