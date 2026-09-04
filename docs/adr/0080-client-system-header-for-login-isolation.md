# ADR-0080：出站 new-api 统一声明 X-Client-System=bluewhale，网关据此做登录系统白名单

- **状态**：Accepted
- **日期**：2026-09-04
- **决策者**：李小强
- **关联工单**：无（--no-issue）
- **上游契约**：网关侧文档 `docs/blue-whale-ai-login-isolation.md`（在网关仓 `blue-whale-api` 的「账号可登录系统白名单」分支，未在本仓）

## 背景

blue-whale-ai 与 new-api 控制台（web/default）共用同一套账号体系（`users` 表）。网关新增「账号可登录系统」登录白名单（`users.allowed_systems`）：登录时按请求头 `X-Client-System` 判断来源系统（`bluewhale` / `api`），账号白名单不含该来源则拒绝登录。**只拦登录，不拦 API 调用**；已登录会话不追溯。

BFF 是账号登录/注册的唯一入口（`account.service` → `createNewApiClient`）。若不带来源头，网关默认按 `api` 处理，蓝鲸用户将被自己的白名单配置挡在门外。

## 决策

1. **传输层统一注入**：`packages/core/src/new-api-transport.ts` 的 `performRequest()`（new-api 账号/API 出站的统一入口，login/register/usage/identity/充值/worker 成本查询均经过；素材库透传层 `material-library-client.ts` 与 OAuth 浏览器重定向除外）在 X-Trace-Id 注入块后声明：

   ```ts
   if (!headers.has("X-Client-System")) {
     headers.set("X-Client-System", CLIENT_SYSTEM_BLUEWHALE);
   }
   ```

   `CLIENT_SYSTEM_BLUEWHALE = "bluewhale"` 常量随 `NewApiError` 一起从 `packages/core` 导出。`if (!headers.has(...))` 允许调用方显式覆盖，为将来对接其他网关系统留口。
2. **头值硬编码常量**，不引入配置项：本仓即「蓝鲸」语义的事实来源，网关只有 `bluewhale`/`api` 两值，无配置需求。
3. **login/register 200 业务失败分支统一透传 Go 文案**：`auth-error.ts` 新增 `projectAccountBusinessFailure(error, status)` 投影，`auth.controller.ts` login 用 401、register 用 400（原有同构先例），不再硬编码「登录凭证无效」。白名单拒绝（HTTP 200 + `success:false` + `"This account is not allowed to log into the current system"`）时用户能看到具体文案。
4. **落 CONTEXT 术语**：「登录来源系统」条目入 `CONTEXT.md`（见下）。

## Considered Options

| 方案 | 取舍 |
| --- | --- |
| **统一注入 performRequest（采纳）** | 一处改动全覆盖，语义一致；worker 的 sk-token 请求带不带头行为一致（网关只拦登录），但统一声明更干净 |
| 仅 BFF 调用点传 `clientSystem` option | 更精确但改动面大、调用点易漏；`NewApiClientOptions` 增加按调用点的 header 参数 |
| 不落文档 | 代码里 `bluewhale` 头无出处，违反「surprising without context」 |

## Consequences

- BFF 发起的所有 new-api 账号/API 请求自动带 `X-Client-System: bluewhale`；网关登录/注册默认值/白名单校验全部对齐，无需逐个接口改。
- 存量账号 `allowed_systems` 为空串 = 全放行，双系统可登录，零迁移。
- OAuth 回调是浏览器重定向，天然无此头，网关默认按 `api` 处理（OAuth 新注册默认 `api`），BFF 无需处理；素材库透传层（`material-library-client.ts`）不走 `performRequest`，也不带该头——它是产物直传不参与账号登录，网关只拦登录，不受影响。
- 新注册（带 bluewhale 头）默认 `allowed_systems = bluewhale`（网关不信任请求体字段）。
- 影响面：本仓只改 transport 注入 + login/register 透传投影三处；不追溯已登录会话，`/api/me`、Redis 会话均不动。
