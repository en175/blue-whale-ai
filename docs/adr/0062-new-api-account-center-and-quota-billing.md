# ADR-0062：采用 IK4JX2 new-api 账户中心与 quota 计费，取代 Node credits 账本

- **状态**：Accepted
- **日期**：2026-07-28
- **决策者**：朱建业（trueBurger）
- **关联工单**：[IK4JX2](https://e.gitee.com/hangzhou-xuanfu_1/projects/883843/tasks/list?issue=IK4JX2)
- **取代**：[ADR-0060](0060-node-user-identity-and-credits-ledger.md)（原 ADR-0057）

## 背景

blue-whale 正把画布业务从 Java 迁移到 Node。`canvas-v2` 的项目、画布、生成任务和生成 worker 由 Node 控制；Java 仅保留尚未迁移的 MCP/遗留能力。旧 ADR-0060 设计了 Node 自建 `users` 与 `user_credits` 账本，与 new-api 的账户和 quota 分离，会产生双重身份、双重余额和生成扣费不一致。

## 决策

1. **账户中心使用 new-api**。终端用户是 new-api user，登录/注册由 Node 薄代理调用 new-api，凭证为 new-api 签发的 `sk-xxx`。
2. **quota 是唯一余额真相**。Node 不创建或维护 `users`、`user_credits`、credits ledger；前端只用配置系数把 quota 换算成展示积分。
3. **生成由 Node 编排，计费由 new-api relay 执行**。Node generation worker 调用 new-api `/v1/*`，把用户 `sk-xxx` 透传给 relay，由 new-api 自动扣 quota；Node 保留显式环境开关控制的直连 provider fallback，仅用于本地故障隔离。
4. **用户持有凭证采用 MVP 方案 A**。前端 localStorage 保存 `sk-xxx`，每次调用 Node 带 `Authorization: Bearer sk-xxx`；Node 不实现 refresh token。后续若改为 Node 终结凭证，替换认证适配层，不改变画布 API 和 worker provider 端口。
5. **只对 `blue_whale_api/` 增加最小身份解析接口**。new-api 提供一个受 `sk-xxx` 鉴权的只读接口，
   返回该 Token 所属的稳定 `user_id` 与账户状态；蓝鲸 BFF 使用服务端解析结果建立产品归属，
   浏览器只提交凭证、不提交 `user_id`；BFF 不信任任何客户端身份声明，也不再用 Token 指纹派生身份。
   除这条身份 seam 外，账户能力继续
   复用 new-api 现有接口，不在蓝鲸复制账户规则。
6. **默认 API Key 是上线前注册不变量**。`GENERATE_DEFAULT_TOKEN` 默认开启；注册事务必须同时创建
   默认 `sk-xxx`，创建失败则注册失败。当前无生产 User，不建设历史补建或登录自愈；登录发现缺少
   Token 时返回明确配置错误。蓝鲸普通 User 界面不展示 API Key 管理入口。
7. **蓝鲸账户 UI 由 new-api 能力配置驱动**。BFF 从 new-api `/api/status` 投影蓝鲸已适配的公开
   认证能力，浏览器不直接访问 new-api，也不维护重复开关。首版密码登录使用单一标识输入，
   同时接受用户名或邮箱；注册、邮箱验证及后续 OAuth 入口仅在上游启用且蓝鲸已适配时展示。
8. **第一实施切片只建设账户适配 seam 与最小登录闭环**。范围是可注入 new-api typed client、
   蓝鲸账户 BFF、Token → User ID 解析以及登录所需的最小前端改动；不接管正在并行建设的 API Key
   管理、管理员用户管理和复杂账户配置界面。手机号登录/换绑、OAuth、Passkey 与 2FA 延后集成，
   即使 new-api 已具备对应能力也不在首版展示。
9. **保留现有蓝鲸账户 HTTP 合同并补齐缺口**。首版使用 `GET /api/auth/capabilities`、
   `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me` 与
   `GET /api/usage/token`；内部统一委托账户 typed client。移除旧手机号短信入口与换绑能力；
   默认 API Key 无 refresh 语义，因此不保留或伪造 `/api/auth/refresh`。
10. **普通 logout 不撤销默认 API Key**。首版只清除浏览器 `localStorage`、蓝鲸内存账户状态与
    相应客户端缓存；new-api 中的默认 Key 保持有效，避免中断后台 GenerationJob 或制造废弃 Key。
    凭证泄露后的轮换属于独立管理员安全操作，不与退出登录混用。
11. **GenerationJob 保存提交时的加密执行凭证**。BFF 以 AES-256-GCM 封装 `sk-xxx` 后随任务
    持久化，独立 worker 只在调用 new-api relay 前于内存解密；图片与视频统一采用该机制。
    任务查询、快照、日志与错误不得暴露凭证或密文。worker 不按 User ID 回查或导出用户 Key；
    logout 不影响已接纳任务，管理员轮换导致旧任务凭证失效时任务明确失败并由 User 重新提交。
12. **普通产品请求短缓存认证用户上下文**。BFF 以 Token 摘要为键、只缓存 `user_id/status`，
    最长 60 秒；未命中时调用 new-api 身份解析接口。new-api 明确返回禁用、删除或无效 Token 时
    立即清除缓存；账户安全操作与管理员操作绕过缓存实时验证。首版接受封禁最多延迟 60 秒生效，
    不在浏览器或缓存中保存明文 Key。
13. **身份解析失败关闭并稳定分类错误**。有效的 60 秒缓存可以继续使用；缓存过期且 new-api
    不可达时不得使用过期身份。缺失或无效凭证返回 `401`，User 禁用返回 `403`，上游异常响应返回
    `502`，连接失败或超时返回 `503`；不得把上游故障伪装成登录过期。已接纳 GenerationJob
    不依赖此解析路径，继续使用任务内加密凭证尝试 relay。
14. **注册成功即建立蓝鲸登录态**。new-api 在同一注册事务中创建 User 与默认 API Key，并返回
    `user_id`、`username`、可选 `email` 与完整 `sk-xxx`；创建任一部分失败则整体失败。蓝鲸将其
    适配为与登录一致的成功响应并直接保存登录状态，不要求 User 再次提交账号密码。启用邮箱验证时，
    验证属于注册前置条件，不改变注册成功后的自动登录语义。
15. **生产只公开蓝鲸账户界面与 BFF**。浏览器只访问蓝鲸同源 `/api/**`，`NEW_API_BASE_URL`
    仅存在于服务端环境；new-api 用户、quota 与 relay 接口置于内部网络供 BFF/worker 调用。
    new-api 管理控制台通过独立受控入口提供给管理员，不向普通互联网 User 暴露其品牌、地址或
    API Key 管理页。首版可按部署条件逐步收紧，但应用合同不得依赖浏览器直连 new-api。
16. **完成证据覆盖五层**：new-api 注册/登录/身份解析测试；蓝鲸 typed client 与 BFF 合同及
    `401/403/502/503` 映射测试；注册自动登录、刷新恢复、账户/quota、logout 的最小浏览器闭环；
    图片/视频加密凭证及无泄露回归；以及蓝鲸与真实本地 new-api 的注册→登录→me→quota→生成任务
    联调。只有 mock 通过不算接口打通。

## 连锁影响

- ADR-0060 的 Node `users` / `user_credits` / JWT 账本实现不再落地；已存在的旧基线文档仅作为历史记录保留。
- Node 需要提供可注入的 new-api typed client，覆盖登录、token usage、token logs 和 relay。
- typed client 还需覆盖 Token → 稳定 `user_id` 的身份解析；默认 API Key 可轮换，但蓝鲸产品归属不变。
- `blue_whale_web` 的登录 UI 改用 username/password；旧手机号验证码用例保留，但不再是入口。
- quota 查询和 `quotaToCredits` 展示共用同一 Node usage 路由。
- Java MCP/遗留接口继续通过既有 gateway rewrite 使用，不纳入本次生成链路。

## 错误与测试边界

- new-api 的 HTTP 错误和业务错误都必须转换为稳定 Node 错误，不把上游 HTML 或内部堆栈返回浏览器。
- 测试覆盖登录拿到 `sk-xxx`、usage 查询、relay 带 token、relay 失败和 fallback；端到端验收使用 mock new-api，不修改 Go 服务。
