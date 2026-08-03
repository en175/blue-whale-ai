# IK50GB-C 收口、Java 退役与媒体鉴权设计

**日期：** 2026-08-03
**状态：** 待用户书面评审
**依据：** ADR-0059、ADR-0062、`2026-07-29-authenticated-user-context-design.md`、`2026-07-28-new-api-media-relay-design.md`

## 1. 目标与顺序

本工作按三个串行阶段完成：

1. 收口 IK50GB-C，以真实环境证明 BlueWhale 核心链路不依赖任何 Java 服务。
2. 在无 Java 验收通过后，物理删除 Java 源码、部署资产和遗留引用。
3. 以统一认证内核覆盖图片、视频生成接口，并按接口清单验证覆盖率，而不是复制接口级鉴权实现。

任一阶段失败都阻塞下一阶段。尤其禁止在无 Java 验收通过前删除仍可能承载迁移、夹具或协议事实的 Java 文件。

## 2. 阶段一：IK50GB-C 无 Java 真实验收

### 2.1 验收拓扑

验收环境只允许启动：

- Next.js Web/BFF；
- `agent-worker` 与 `generation-worker`；
- new-api；
- MySQL、Redis、对象存储或其受控测试替身。

Java Gateway、User Service、Product Service 和其他 `blue_whale_server` 进程不得启动，也不得作为健康检查或隐式 fallback。

### 2.2 核心验收链路

真实服务 smoke 必须依次证明：

1. 用户注册并获得 new-api Token；
2. 用户名或邮箱加密码登录；
3. `/api/me` 返回稳定 new-api 用户身份；
4. quota 查询成功；
5. Project 创建、读取与更新成功；
6. Conversation/GenerationInbox 可写可读；
7. 创建文生图任务并得到终态 Asset；
8. 创建文生视频任务并得到终态 Asset；
9. quota 变化归属于当前登录用户；
10. 全程没有请求 Java 地址，没有使用 Java JWT、浏览器 `X-User-Id` 或 Token 指纹充当 owner。

外部供应商调用保留显式 opt-in。默认 CI 使用真实本地 new-api 加受控 provider stub；带费用的 live probe 只在用户另行授权并提供测试凭证时运行，输出必须脱敏。

### 2.3 失败与证据

- 认证失败统一返回 `401/403`；new-api 不可用返回 `502/503`。
- provider、quota 或持久化失败不得伪造成功 Asset。
- 验收脚本不得打印 `sk-xxx`、密封凭证、密码或数据库密钥。
- 完成证据包括服务清单、HTTP 状态、资源 ID、Job 终态和脱敏 quota 变化；mock 单测不能单独作为完成证据。

## 3. 阶段二：物理删除 Java

### 3.1 删除前迁出

删除 `blue_whale_server` 前先建立引用清单。仍在使用的内容必须迁入其事实所有者：

- 数据库 migration/seed 迁入 `packages/persistence`；
- 跨进程协议迁入 TypeScript 契约包或文档；
- 必需测试 fixture 迁入对应 TypeScript 测试目录；
- 部署参数迁入当前 Compose、Dockerfile 或部署文档。

历史 ADR 和研究文档保留原始记录，但加退役说明；不得为消除文本命中篡改历史事实。

### 3.2 删除范围

- 整个 Java 源码树及 Maven 构建入口；
- Java 镜像、Dockerfile、Compose 服务和部署脚本；
- Java 专属 CI、健康检查、环境变量与端口；
- `GATEWAY_URL`、Java JWT fallback、`/api/user/*` rewrite；
- 运行时 `X-User-Id` 信任和 Java 服务地址。

### 3.3 防回归

静态守卫扫描生产代码和当前部署资产，禁止重新引入上述运行时依赖。历史文档和明确标注的迁移档案从扫描中排除。

删除完成后重新运行阶段一的完整验收，证明删除没有依赖运气或未声明的本地服务。

## 4. 阶段三：统一图片/视频接口鉴权

### 4.1 统一入口

所有受保护生成 Route 使用同一个 `withAuthenticatedUser` 深模块。它解析浏览器提交的 new-api Bearer Token，得到：

- `userId`：资源所有权和审计身份；
- `providerCredential`：仅供密封并交给异步 Job；
- 稳定错误分类，不向调用方暴露凭证或摘要。

Route 不自行解析 Token，不接受浏览器提供的 owner ID，也不实现各自的 JWT fallback。

### 4.2 统一资源授权

所有输入 Asset 通过统一仓储能力按 `userId + projectId + assetId` 解析：

- 缺失、跨项目或跨用户 Asset 在 provider 调用前拒绝；
- 文生图和文生视频允许零个输入 Asset；
- 图生图和图生视频只接受模型契约支持的已授权输入；
- 不支持的数量或媒体类型以 `unsupported_input` 失败，不发生计费调用。

### 4.3 异步凭证边界

创建 Job 时使用专用 `GENERATION_CREDENTIAL_SECRET` 密封 `providerCredential`。Worker 领取任务后解密，并通过统一 new-api Client 注入 `Authorization`。

公开 Job、Snapshot、事件、日志和错误响应必须过滤明文及密封凭证。Worker 不得用某一用户的凭证领取全局其他用户任务。

### 4.4 接口覆盖方式

鉴权实现统一，验收按接口逐项进行。清单至少包括：

- `POST /v1/images/generations`；
- `POST /v1/images/edits`；
- `POST /v1/video/generations`；
- `GET /v1/video/generations/:taskId`；
- BlueWhale 创建、重试、取消和查询生成 Job 的 Route。

静态覆盖测试保证新增生成 Route 必须显式进入统一鉴权入口；契约测试逐项检查 Authorization、所有权拒绝、quota 归属、错误映射和凭证脱敏。

## 5. 提交与工作流边界

三个阶段分别形成可审查、可回退的提交：

1. `test: 建立无 Java 真实验收基线`
2. `refactor: 物理退役 Java 运行时`
3. `feat: 收口媒体接口统一鉴权`

实现从同步后的本地 `master` 通过 `scripts/start-task-worktree.sh` 创建任务 worktree。阶段一通过并提交后，阶段二才开始；阶段二通过后，阶段三才开始。没有明确发布授权时只提交到本地任务分支，不 push、不创建 PR、不合并远端。

## 6. 完成定义

只有同时满足以下条件才算整体完成：

- 完整 smoke 在 Java 完全不启动且源码已删除的仓库中通过；
- 注册、登录、身份、quota、产品读写、图片和视频生成全部成功；
- 四类 new-api 媒体接口均经统一凭证注入和资源授权；
- 跨用户 Asset 和 Job 操作在 provider 调用前被拒绝；
- 公开数据与日志不含用户 Token 或密封凭证；
- 全量类型检查、单元测试、集成测试和静态守卫通过；
- ADR、规格、部署文档与实际拓扑一致。
