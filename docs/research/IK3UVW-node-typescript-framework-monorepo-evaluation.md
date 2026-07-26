# IK3UVW：Node.js 服务框架与 TypeScript Monorepo 方案评估

> **IK3UUX 范围状态**：保留为选型输入；最终范围是模块化单体代码库与三个必要 Node 入口，
> 不把研究中的独立部署、版本治理或扩展能力自动纳入实施，见
> [ADR-0055](../adr/0055-prelaunch-typescript-unification-scope.md)。

> 仓库基线：`8caaba40b6be535831be14c100e8ebd9ef9c122d`
>
> 研究日期：2026-07-25
>
> 研究问题：在严格 TypeScript、多个独立部署单元、共享领域/契约包，以及既有
> MySQL、Redis、对象存储和 VKE/IRSA/KMS 约束下，选择 Node.js 服务框架、包管理、
> monorepo 编排、编译和部署组合。
>
> 本文是下游 HITL 票《确定目标 TypeScript 运行时与仓库总体架构》的研究输入；
> 文中的选择是研究推荐，不替代该票与用户锁定最终架构。

## 1. 结论

**研究推荐：**

1. **Product API 使用原生 Fastify，不采用 NestJS 作为默认应用壳。**
   HTTP 边界使用运行时 schema 和 Fastify 官方 Type Provider；领域与应用代码保持纯
   TypeScript，不引用 Fastify 类型。
2. **Agent Worker 与 Generation Worker 使用纯 TypeScript composition root。**
   Worker 没有公开 HTTP 职责时不引入 Web 框架；确有健康检查或内部 HTTP 入口时，只挂最小
   Fastify adapter，不让 HTTP 生命周期拥有 Run、Job 或 checkpoint。
3. **`blue-whale-pay` 的 Node 运行单元在传输协议冻结后复用原生 Fastify。**
   本票不替后续支付边界票选择 HTTP、gRPC 或其他 RPC；若最终不是 HTTP，业务内核仍不受影响。
4. **仓库采用 pnpm workspaces + package-based Nx。**
   pnpm 负责依赖、单锁文件、workspace 链接与逐应用部署；Nx 只负责项目图、affected、缓存和
   静态边界，不采用 Nx integrated layout，也不同时引入 Turborepo。
5. **`tsc -b` 是严格类型检查和 Node 制品编译基线。**
   Next.js 继续用 `next build`；Nx 只编排这些包脚本。Node 服务默认不 bundle，
   构建后由 `pnpm deploy --filter ... --prod` 形成独立、可搬运部署目录。
6. **不采用 `tsup`。**
   其官方仓库已经明确声明不再积极维护；当前需求也没有必须 bundle Node 服务的证据。

该组合把框架限制在进程边缘，把静态模块边界交给 package/Nx，把类型与运行时校验合并在契约
schema，把部署隔离交给每个应用自己的制品和 VKE 身份。它没有改变现有 Product API 权威、
Worker 执行边界、MySQL 事务语义、对象存储发布顺序或 KMS 凭据模型。

## 2. 范围与假设

### 2.1 本票形成研究推荐

- Product API、Worker 和未来支付运行单元采用什么应用壳；
- 共享 TypeScript 包如何被约束、检查和构建；
- 包管理、任务图、类型检查、编译和逐服务制品如何分工；
- 哪些候选适合进入下游默认路线，哪些应退出，以及何时允许重新评估。

### 2.2 本票不决定

- MySQL driver、query builder 或 ORM；
- Redis client、队列产品、对象存储 SDK 或媒体 provider；
- Product API 与 Worker、Go 与 `blue-whale-pay` 的最终传输协议；
- 公开 DTO 的完整字段、JSON Schema 方言和版本兼容规则；
- Kubernetes manifest、镜像基础镜像、CI 平台或发布顺序；
- Node Agent 编排框架。

### 2.3 研究假设

- 生产运行时使用实施时仍受支持的 Node.js LTS，并在仓库中固定版本；
- 现有 Next.js 前端与新 Node 服务进入同一个 TypeScript workspace；
- Product API、Agent Worker、Generation Worker、支付通道和 schema migrator 仍是不同部署
  目标，不因同仓库或同语言合并进程；
- “共享领域包”只共享稳定的纯领域概念；数据访问、框架模块、SDK client 和运行单元私有状态
  不进入通用共享包。

## 3. 研究事实

### 3.1 本项目已经冻结的事实

1. Product API 是浏览器可见产品事实的唯一控制面；Agent Worker 和 Generation Worker 是独立
   执行单元，不能直接拥有产品事实。当前规划还明确拒绝把三个单元合回一个进程。
   [ADR-0015，第 6–22 行](../adr/0015-java-product-control-plane-python-runtime.md#L6-L22)
2. Node 重建必须保留状态、事件和 Outbox 的同事务接纳、独立幂等域、数据库 version/lease/fence、
   MySQL V1–V18 migration lineage，以及 object-first / DB-publish。
   [现状基线，第 120–170、418–477 行](IK3UVU-node-rewrite-current-state-baseline.md#L120-L477)
3. 生产运行单元部署在 VKE，每个单元使用独立 Kubernetes ServiceAccount 与 IRSA 角色；
   Product、Agent、Generation 的凭据集合不可共享。
   [ADR-0020，第 6–18 行](../adr/0020-volcengine-vke-irsa-kms-production-identity.md#L6-L18)
4. 生产凭据由进程使用官方 SDK 和 IRSA 临时身份读取，保存在内存；数据库和 Redis 轮换要求能够
   建立新连接池、健康验证后切换并释放旧连接池。
   [ADR-0030，第 6–16 行](../adr/0030-runtime-fetches-kms-secrets-with-irsa.md#L6-L16)
5. Schema migration 是独立、fail-closed 的运行目标；应用只能在 migration 成功后启动。
   [ADR-0037，第 44–64 行](../adr/0037-schema-migration-framework.md#L44-L64)
6. 现有 Next.js 前端已开启 TypeScript `strict`，已有 Vitest、Playwright、ESLint 和 Prettier
   脚本；迁入统一 workspace 不需要重选这些工具。
   [前端 tsconfig，第 2–15 行](../../blue_whale_web/tsconfig.json#L2-L15)；
   [前端 package.json，第 5–24、44–64 行](../../blue_whale_web/package.json#L5-L64)

代码图谱对上述边界提供了补充验证：worktree 专属
`Blue-Whale-AI-docs-ik3uvw` 索引中同时存在 TypeScript、Go、Java、
Python 和 SQL；`ProjectEventService`、`AgentRunWorkerService`、`GenerationJobClaimService`
以及 `SchemaMigrationRunner` 仍位于当前 Java Product 边界，Python Worker 有独立入口。
图谱查询：`get_architecture(project="Blue-Whale-AI-docs-ik3uvw")` 与
`search_graph(name_pattern=".*(ProjectEventService|AgentRunWorkerService|GenerationJobClaimService).*")`。

### 3.2 NestJS 官方能力

**研究事实：**

- Nest module 默认封装 provider，只有显式 export 的 provider 才构成其他 module 可用的接口；
  module graph 用于解析 provider 依赖。
  [NestJS Modules](https://docs.nestjs.com/modules)
- Nest 支持无网络 listener 的 standalone application context，可把 IoC container 用于
  worker、脚本或 CLI；但 HTTP middleware、interceptor、pipe 和 guard 不会在 standalone
  context 中执行。
  [NestJS Standalone applications](https://docs.nestjs.com/standalone-applications)
- Nest 可通过 `@nestjs/platform-fastify` 使用 FastifyAdapter；同时官方警告依赖 Express 的
  recipe 不一定可用，必须换成 Fastify 对应组件。
  [NestJS Performance (Fastify)](https://docs.nestjs.com/techniques/performance)
- Nest 的常规请求校验路径是 `ValidationPipe` + `class-validator` +
  `class-transformer`。官方说明 TypeScript interface/generic 没有足够运行时 metadata，
  DTO 通常需要 concrete class，type-only import 也会在运行时被擦除。
  [NestJS Validation](https://docs.nestjs.com/techniques/validation)
- `@nestjs/testing` 能创建 isolated TestingModule、替换 provider，并创建完整应用做 e2e 测试。
  [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)

### 3.3 原生 Fastify 官方能力

**研究事实：**

- Fastify 推荐用 JSON Schema 同时做请求校验和响应序列化；请求默认由 Ajv 校验，响应 schema
  由 `fast-json-stringify` 使用。响应 schema 也能限制意外泄露的字段。
  [Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- Fastify 官方 Type Provider 覆盖 `json-schema-to-ts`、TypeBox 和 Zod，可从路由 schema
  推导 request/reply 类型；Type Provider 按 encapsulation scope 生效。
  [Fastify Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)
- Fastify plugin 的 encapsulation context 控制 decorator、hook、plugin 和 route 的可见范围；
  子 scope 可见父 scope，父 scope 默认看不到子 scope。
  [Fastify Encapsulation](https://fastify.dev/docs/latest/Reference/Encapsulation/)
- `fastify.inject()` 不开启真实 socket 就能启动全部已注册 plugin 并测试完整 HTTP 路由。
  [Fastify Testing](https://fastify.dev/docs/latest/Guides/Testing/)
- Fastify 默认 Ajv 配置会做类型 coercion、default 注入和有条件的额外字段删除；默认校验错误也会
  出现在响应中。安全错误契约严格的应用必须显式测试并覆盖这些默认行为。
  [Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)

### 3.4 pnpm、Nx、Turborepo 与 TypeScript 官方能力

**研究事实：**

- pnpm workspace 支持 `workspace:` protocol；单一 workspace lockfile 下，每个 package 仍只能
  访问自己 `package.json` 声明的依赖，并可禁止 workspace cycle。
  [pnpm Workspaces](https://pnpm.io/workspaces)
- `pnpm deploy` 会把一个 workspace package、其生产依赖和 workspace 依赖复制到独立目录，
  形成可搬运制品；当前默认模式要求 `inject-workspace-packages=true`，并为部署生成专用 lockfile。
  [pnpm deploy](https://pnpm.io/cli/deploy)
- TypeScript project references 把程序拆成多个 `composite` project；`tsc -b` 会发现引用图、
  检测新旧状态并按正确顺序构建。
  [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- Nx 的 `@nx/enforce-module-boundaries` 可用 project tag 对 TypeScript import 和
  `package.json` dependency 建立约束；`nx affected` 用 Git 变化和 project graph 只运行受影响
  任务。Nx 可低侵入加入已有 pnpm workspace。
  [Nx Enforce Module Boundaries](https://nx.dev/docs/features/enforce-module-boundaries)；
  [Nx Affected](https://nx.dev/docs/features/ci-features/affected)；
  [Adding Nx to an existing workspace](https://nx.dev/docs/guides/adopting-nx/adding-to-monorepo)
- Turborepo 提供任务图、缓存和 `prune`；但截至研究日，`turbo boundaries` 官方仍标记为
  **Experimental**。
  [Turborepo configuration](https://turborepo.com/docs/reference/configuration)；
  [Turborepo prune](https://turborepo.com/docs/reference/prune)；
  [Turborepo boundaries](https://turborepo.com/docs/reference/boundaries)
- `tsup` 官方仓库明确声明不再积极维护，并建议用户考虑其他方案。
  [tsup 官方仓库](https://github.com/egoist/tsup)

## 4. 结合本项目约束的推论

### 4.1 为什么原生 Fastify 优于 NestJS + Fastify

| 维度 | 原生 Fastify | NestJS + Fastify | 项目判断 |
|---|---|---|---|
| 编译期与运行时契约 | 路由 schema 可直接驱动校验、序列化和类型推导 | 默认 DTO class 与 decorator；共享 schema 仍需另建桥接 | 原生 Fastify 少一套表达 |
| 领域隔离 | 需靠 package、exports、Nx tag 和 composition root | module 可封装 provider，但不能禁止任意 TS 文件 import | 两者都需静态边界；Nest 不能替代 Nx |
| Product API 复杂度 | 显式 plugin/composition，框架面小 | DI、module、guard、pipe、interceptor 完整 | Nest 起步更整齐，长期框架耦合更高 |
| Worker 适配 | Worker 不需要 Fastify；只复用纯 TS 包 | standalone context 可用，但 HTTP guard/pipe 不生效 | 没有必要为 IoC 把 Worker 绑定 Nest |
| 测试 | domain 直接测试，HTTP 用 `inject` | TestingModule/provider override 更成熟 | 两者都合格 |
| SSE 与流式响应 | 直接控制 Fastify/Node reply | 需同时处理 Nest abstraction 和 Fastify adapter 细节 | 原生 Fastify 更少转换层 |
| MySQL/Redis/KMS 轮换 | 显式资源 owner 和 close hook | provider lifecycle 可承载 | 两者都能做；语义由项目 adapter 决定 |
| 迁移认知成本 | 团队需建立 composition/lifecycle 约定 | 与 Spring 的 module/DI/decorator 形态较接近 | Nest 短期熟悉感更强，但也更容易照搬 Java 分层 |
| 长期退出成本 | HTTP adapter 薄，领域包无框架依赖 | decorator、DI token、module metadata 容易扩散 | 原生 Fastify 更容易替换 |

**项目推论：**

1. 本项目真正困难的是 transaction acceptance、幂等、lease/fence、恢复和跨进程契约，不是
   controller/provider 装配。Nest 不会减少这些领域代码。
2. Nest module 的 provider encapsulation 是运行时 DI 可见性，不是编译期 import 边界。
   既然 package/Nx 仍然必需，Nest 的主要额外价值只剩 IoC、lifecycle 和 decorator 生态。
3. Product API 需要跨 Next.js、Worker 和 Go 的稳定契约。把 Nest DTO class 当权威会使
   class metadata 成为第二套契约；原生 Fastify 的 runtime schema 更容易保持“一个 schema，
   同时校验和推导类型”。
4. Agent/Generation Worker 的业务入口是 claim、commit、result acceptance 和 reconciliation，
   不是 HTTP request pipeline。为它们统一套 Nest 会让无关的 framework lifecycle 侵入执行内核。
5. 选择原生 Fastify并不意味着把所有代码写成 route handler。Fastify 只负责 transport adapter；
   应用服务、领域模型、端口和事务边界仍是独立的纯 TypeScript 深模块。

### 4.2 Hono、Express 和 Nest + Express 的位置

**研究事实：** Hono 提供 Web Standards 多运行时、typed RPC client 和 strict TypeScript
推导；官方也说明全局 error handler 的响应不会自动进入 RPC 推导，需要额外类型合并。
[Hono Overview](https://hono.dev/docs)；
[Hono RPC](https://hono.dev/docs/guides/rpc)

**项目推论：**

- Hono 的多运行时优势对固定部署在 Node/VKE 的 Product API 没有直接收益；把 client 类型绑定到
  `typeof app` 也不如独立、版本化 runtime schema 适合跨进程契约。因此不进入推荐候选。
- Express 5 是成熟的 middleware/router 底座，但它不直接提供 Fastify 的 schema
  validation/serialization/type-provider 组合。本项目新建服务没有保留 Express 兼容性的必要。
  [Express 5 middleware](https://expressjs.com/en/5x/guide/writing-middleware/)
- Nest + Express 只比 Nest + Fastify 多出默认生态兼容性；它没有解决本项目的契约和边界问题，
  因此不应成为新服务默认值。

### 4.3 为什么采用 pnpm + package-based Nx

| 候选 | 优点 | 不足 | 判断 |
|---|---|---|---|
| 仅 pnpm workspaces | 最少工具；workspace、filter、deploy 已覆盖基础需求 | affected、任务缓存和依赖方向策略要自行拼接 | 可作 bootstrap，不是最终治理面 |
| pnpm + Turborepo | 任务图、缓存、filter、prune 简洁 | 当前 boundary command 仍为实验；`pnpm deploy` 已覆盖主要制品裁剪需求 | 不采用 |
| pnpm + package-based Nx | 稳定 tag boundary、project graph、affected、缓存；可保留原 package scripts | 增加 Nx 配置和升级面 | **采用** |
| Nx integrated workspace | 生成器、插件和布局统一度最高 | 迁移侵入高，容易让 Nx 成为所有工具的第二配置源 | 不采用 |

**项目推论：**

- Product、Agent、Generation、Payment 和 Web 同时存在后，workspace 依赖方向本身就是架构规则，
  不是单纯 CI 加速问题；因此仅 pnpm 不足。
- Nx 应保持“旁路治理层”：package script 是构建/测试真相源，Nx 读取并编排它们。这样退出 Nx
  不会改变任一应用的构建命令。
- 不启用 Nx Cloud 作为正确性前提；remote cache 是后续性能优化，边界 lint、`tsc -b` 和测试在
  无云缓存时仍须完整工作。
- Turborepo 的任务能力与 Nx 重叠，不应双装。其 boundary 稳定后也只有在 Nx 升级/运维成本出现
  可量化问题时才重新比较。

### 4.4 为什么用 `tsc -b`，默认不 bundle

**项目推论：**

1. `tsc -b` 同时给出严格类型检查、declaration、project reference 顺序和普通 Node.js 输出，
   已满足当前服务需求；Nx 再负责跨项目缓存和 affected。
2. Node 服务依赖 MySQL、Redis、对象存储、KMS SDK 和可能含条件 exports/native addon 的包。
   默认保留标准 Node package resolution，比 bundle 后逐个维护 external 列表更透明。
3. `pnpm deploy` 已能产出单应用生产依赖目录，bundle 不是缩小构建上下文或隔离 workspace
   依赖的必要条件。
4. `tsup` 同时缺少当前需求和长期维护理由。不能因为它配置少就把它放入关键生产构建链。
5. 若后续实测 Node 服务冷启动、镜像大小或构建时长不达标，应以量化门槛单独评估
   esbuild/SWC/tsdown；在此之前不增加第二编译语义。

## 5. 推荐架构边界

### 5.1 应用与包的角色

以下是职责结构，不是本票要求立即创建的目录清单：

```text
apps/
  web                    Next.js，独立构建与部署
  product-api            原生 Fastify，唯一公开产品控制面
  agent-worker           纯 TS Worker composition root
  generation-worker      纯 TS Worker composition root
  blue-whale-pay         传输 adapter + 纯 TS 支付通道内核
  schema-migrator        纯 TS、一次性、fail-closed 运行目标

packages/
  contracts-*            runtime schema、推导类型、错误码、版本元数据
  domain-*               纯领域类型和规则，按 owner/scope 拆分
  ports-*                产品中性端口；不含框架、SDK 或数据库类型
  adapters-*             MySQL、Redis、TOS、KMS、provider 的实现
  test-support-*         契约夹具与测试工具，不进入生产依赖
```

**研究推荐：**

- `contracts-*` 是可跨运行单元共享的 wire contract，不得包含 ORM entity、Fastify request、
  Nest decorator、数据库 row、SDK response 或 secret；
- `domain-*` 必须有明确 owner。禁止建立无 owner 的 `common` / `shared` 大包；
- adapter 可以依赖 port/domain/contract，反向依赖禁止；
- app 是 composition root，可以依赖本运行单元允许的 domain/port/adapter；
- Agent/Generation package 不能导入 Product 数据库 adapter；
- 支付 contract 可以由 Go 和 Node 共同生成/验证，但 Go 订单与 quota 权威不能迁入共享 TS 包。

建议的 Nx tag 至少表达两个正交维度：

- `type:app | contract | domain | port | adapter | test-support`
- `scope:web | product | agent | generation | payment | shared`

边界规则必须覆盖直接 import 和 `package.json` dependency，不能只靠目录命名或 code review。

### 5.2 HTTP 契约与类型安全

**研究推荐：**

- Product API 的 request、response 和公开错误以 runtime schema 为事实源；
- Fastify 边界默认使用官方 TypeBox Type Provider，使 schema 同时提供运行时校验和 TS 推导；
- 跨进程 package 导出 schema 与推导后的中性类型，不导出 Fastify route/app 类型；
- response schema 必须覆盖成功和稳定错误 envelope；
- Fastify 默认 coercion、default、额外字段处理和 validation error 输出必须显式配置并做契约测试，
  不能依赖默认值；
- SSE 事件仍来自控制面已接纳的持久化事实，Fastify stream 只负责传输。

TypeBox 是当前默认，不是不可替换的产品格式。若后续契约票证明另一个 JSON Schema 工具在
跨语言生成、OpenAPI 或 Go 互操作上更合适，只要保持 schema-first 和中性 package 边界，
可以替换 Type Provider，而不重新选择服务框架。

### 5.3 构建与部署边界

| 目标 | 类型检查/构建 | 生产制品 | 运行身份 |
|---|---|---|---|
| Web | Next 自身 typecheck + `next build` | Web 专属镜像 | Web 自身身份 |
| Product API | `tsc -b` | `pnpm deploy --filter product-api --prod` | Product ServiceAccount/IRSA |
| Agent Worker | `tsc -b` | `pnpm deploy --filter agent-worker --prod` | Agent ServiceAccount/IRSA |
| Generation Worker | `tsc -b` | `pnpm deploy --filter generation-worker --prod` | Generation ServiceAccount/IRSA |
| Payment | `tsc -b` | `pnpm deploy --filter blue-whale-pay --prod` | Payment 独立身份，后续冻结 |
| Schema migrator | `tsc -b` | migrator 独立入口/目录 | 受限 DB migration 身份 |

**研究推荐：**

- 每个 app 有自己的 `build`、`test`、`start` 和部署 filter；
- workspace 使用一个锁文件，但每个部署目录有 pnpm 生成的专用 lockfile/依赖闭包；
- image 只复制该 app 的 deploy 目录，不在运行时挂载根 workspace 或共享 `node_modules`；
- 构建必须先完成 shared package 输出，再执行 `pnpm deploy`；
- `inject-workspace-packages=true` 与 injected dependency 同步行为必须进入 workspace
  验收测试，避免已构建 package 的硬链接内容陈旧；
- 单仓同 commit 不等于同批发布；每个运行单元可以独立回滚，但跨进程 contract 仍须满足兼容窗口；
- migrator 继续作为部署门禁，不能退化为 Product API 启动时顺便执行。

## 6. 测试与验收策略

**研究推荐：**

1. **领域测试：** 直接实例化纯 TS domain/application service，不启动 Fastify、Nx 或数据库。
2. **契约测试：** 同一 runtime schema 验证合法/非法 request、response、错误 envelope、事件和
   跨进程 fixture；证明推导类型与运行时 schema 没有双写。
3. **HTTP adapter 测试：** 使用 `fastify.inject()` 覆盖认证上下文、授权、幂等、SSE 建连、
   cursor 过期和安全错误，不监听真实端口。
4. **基础设施集成测试：** 对真实 MySQL 语义验证 transaction、unique、version、lease/fence 和
   migration；对 Redis、对象存储和 KMS adapter 验证连接轮换与 fail-closed。不能用内存替身证明
   MySQL DDL/锁或对象发布语义。
5. **制品测试：** 从每个 `pnpm deploy` 目录启动，而不是从 workspace 源码启动；验证缺少其他 app
   源码、devDependency 或根 `node_modules` 时仍能运行。

Nx `affected` 可缩短 PR 反馈，但 contract、migration 和部署闭包属于高风险共享面；这些 package
变化时必须扩展到全部消费者，发布门禁不能只跑修改目录自己的测试。

## 7. 迁移成本

| 迁移项 | 成本 | 原因 | 控制方式 |
|---|---|---|---|
| 现有 Next 从 npm lock 进入 pnpm workspace | 中 | 锁文件、patch-package、脚本路径和 CI cache 改变 | 单独迁入并先保持现有 Next build/test |
| Java Product API 到原生 Fastify | 高 | 领域事务、鉴权、SSE、migration 和错误契约需重建 | 先冻结 contract，按垂直切片迁移 |
| Python Agent Worker 到纯 TS | 高 | checkpoint/adapter/模型 SDK 行为改变 | 保持 OrchestratorPort 与新 Run 切换语义 |
| Java Generation Worker 到纯 TS | 高 | provider、对象存储、审核和 result acceptance | 先保留 Product acceptance，再替换 executor |
| 引入 package-based Nx | 中低 | 需标注 project/tag 和边界规则 | 先只接入 graph/boundary/affected/cache |
| `tsc -b` project references | 中 | 每个可引用包要定义 composite/output/exports | 以 deployable app 的依赖闭包逐步收敛 |

**项目推论：** NestJS 与 Spring 的表面相似会降低 controller/DI 的短期认知成本，但不会降低
领域重建成本；相反，若按 Java class/package 逐层翻译，会把旧实现结构带入新系统。迁移计划应以
公开命令、RunCommit、Generation result acceptance、SSE recovery 等可验证契约切片，而不是以
“先建完所有 Nest module”推进。

## 8. 风险与缓解

| 风险 | 影响 | 缓解/门禁 |
|---|---|---|
| 原生 Fastify 缺少统一 DI/lifecycle 约定 | connection、client、shutdown ownership 分散 | 每个 app 只有一个 composition root；资源 adapter 必须有显式 start/close/rotate |
| schema-first 使用不严导致类型与运行时漂移 | 非法 payload 被接纳或合法 payload 被拒 | contract package 单一 schema；禁止手写重复 interface；双向 fixture |
| Fastify 默认 coercion/error 细节不符合安全契约 | 类型被静默改变或泄露 schema 细节 | 固定 Ajv/Fastify 配置；自定义 error mapper；恶意输入测试 |
| Nx 变成第二套构建系统 | 本地与 CI 命令分叉、退出困难 | package scripts 是真相源；Nx 只调用脚本；不依赖 Nx Cloud 正确性 |
| pnpm injected dependency 在本地构建后未同步 | deploy 目录包含旧 shared package 输出 | 固定 build→deploy 顺序；配置同步脚本；从 deploy 目录做 smoke test |
| 单锁文件升级扩大受影响范围 | 共享依赖更新同时影响多个运行单元 | 精确版本/目录负责人；Nx lockfile affected 策略；按服务制品回归 |
| 不 bundle 导致镜像偏大 | 拉取和启动变慢 | 先用 `pnpm deploy` 裁剪；只有测量超标再评估 bundler |
| shared package 演化成分布式单体 | Worker 绕过控制面或共享数据库实现 | Nx scope/type 规则；contract 与 adapter 分包；禁止跨 owner persistence import |
| Fastify/Nx/pnpm 大版本升级 | 构建、schema 或 plugin 行为变化 | 固定版本；逐项升级；先跑 contract、制品与恢复测试 |

## 9. 淘汰方案与重新评估条件

### 9.1 NestJS + Fastify：当前不采用，保留有条件备选

淘汰理由：

- 仍需独立 runtime schema 和 Nx 静态边界，Nest module/DTO 没有消除核心工具；
- standalone Worker 不执行 HTTP guard/pipe/interceptor，统一 Nest 并不会统一真正的执行语义；
- decorator、DI token 和 module metadata 容易向 domain/contract package 扩散；
- Fastify adapter 还需遵守平台差异，形成 Nest + Fastify 两层调试面。

重新评估条件：原生 Fastify pilot 出现可量化的装配/生命周期维护问题，并且重复代码无法通过一个
小型纯 TS composition convention 消除；候选 Nest pilot 还必须证明 domain/contract 零 Nest import、
schema 单一事实源以及 Worker 不依赖 HTTP pipeline。

### 9.2 NestJS + Express / 原生 Express：淘汰

新服务没有 Express middleware 兼容债务；选择它会失去 Fastify schema/type-provider/response
serialization 的直接组合，不能换来领域、部署或迁移收益。

### 9.3 Hono：淘汰

Hono 的 typed RPC 和多运行时适合轻量 API/edge 场景，但本项目固定 Node/VKE，且跨进程契约必须
独立于某个 app 类型和前端 client 推导。它不能替代 Product API 的模块、事务与恢复治理。

### 9.4 Turborepo：淘汰

它的任务图、缓存和 prune 都是合格能力，但本项目最关键的增量价值是稳定、可声明的依赖方向。
当前 `turbo boundaries` 仍为实验，而 Nx 已提供稳定 ESLint 边界和 affected graph。禁止同时安装
Turbo 与 Nx。

### 9.5 仅 pnpm：不作为推荐目标状态

适合建立 workspace 的第一步，但随着五个以上 app/运行目标和多类共享包出现，手工维护 affected
命令、缓存键和边界 lint 会产生新的自研工具面。

### 9.6 npm/Yarn/Bun workspace：淘汰

- npm 对现有 Next 的迁移成本最低，但没有比 pnpm 的 workspace protocol + per-app deploy
  组合更直接的独立制品优势；
- Yarn 若使用 node_modules 模式，与 pnpm 能力重叠；若使用 PnP，则额外引入 SDK/tooling
  兼容验证；
- Bun 会把 package manager 与替换 Node runtime 两个决策混在一起，本项目没有此需求。

### 9.7 `tsup` 与默认服务 bundling：淘汰

`tsup` 官方维护状态已经不足以进入新的关键构建链；服务 bundle 本身也没有当前实证需求。
未来若有量化问题，重新比较当时仍维护的 bundler，不把本结论解释为永久禁止 bundle。

## 10. 后续票据输入

本研究没有暴露必须新增的 Wayfinder 票；以下内容应作为既有契约、部署和迁移票的输入：

1. **服务/契约边界票：** 冻结 runtime schema 方言、TypeBox 使用范围、错误 envelope、版本策略、
   schema 到 Go/OpenAPI 的互操作，以及 Fastify Ajv coercion/unknown-field 规则。
2. **Monorepo 基础设施票：** 创建 pnpm workspace 与 package-based Nx；冻结 tag 矩阵、依赖方向、
   project references、单锁文件、Corepack/Node 版本和 package export 规则。
3. **部署票：** 为每个 app 验证 `pnpm deploy` 生产闭包、独立镜像、构建身份、VKE ServiceAccount/
   IRSA、KMS SDK 启动失败和凭据轮换；schema migrator 继续做门禁。
4. **迁移 tracer-bullet 票：** 先以一条包含 runtime schema、MySQL 短事务、Outbox、稳定错误和
   `fastify.inject` 的 Product API 垂直切片验证原生 Fastify；不得先搭空框架大全。
5. **CI/制品票：** 定义 Nx affected 扩散规则、shared lockfile 变化策略、deploy-directory
   smoke test 和 contract/migration 的全消费者门禁。

## 11. 研究推荐摘要

```text
HTTP：原生 Fastify，仅存在于 transport adapter
Worker：纯 TypeScript composition root
契约：runtime schema 为事实源，默认 Fastify TypeBox Type Provider
包管理：pnpm workspaces，单锁文件，workspace:，禁止 cycle
Monorepo：package-based Nx，仅 graph / boundary / affected / cache
类型与编译：tsc project references；Web 保持 next build
部署：每个 app 独立 pnpm deploy 目录、镜像和 VKE 身份
不采用：Nest 默认壳、Express、Hono、Turborepo、仅 pnpm、tsup、默认服务 bundle
```

推荐路线不是“用 Fastify 重写 Java controller”，而是先冻结中性契约和 package 边界，再让
Fastify 成为最薄的 HTTP 入口，让 Product、Agent、Generation 和 Payment 各自按既有权威边界
独立构建、测试、部署和回滚。
