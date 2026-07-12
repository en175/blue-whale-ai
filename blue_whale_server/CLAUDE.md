# 后端 blue_whale_server

本文件在 agent 进入 `blue_whale_server/` 目录时自动加载。根 `CLAUDE.md` 只保留仓库总览与跨端协作约定。

> **元约束**：本文件只承载**约束与导航**，不是事实手册。版本号、端口、namespace、数据库地址等具体值会随版本演进，**一律以代码为准**：版本基线见 `blue-whale-parent/pom.xml`，各服务配置见对应 `*-service` 的 `application.yml` 或 `bootstrap.yml`。文档与代码矛盾时，**当场修正本文件**。

## 路由表：后端场景去哪查

| 场景 | 去哪 |
|------|------|
| **编码规范**（分层/响应/异常/数据访问/事务/并发/命名） | **`README.md` §5（严格遵守）** |
| agent 高频违反项（速查） | 本文件末「agent 高频红线」 |
| 代码理解（查结构/调用链/架构） | `.claude/rules/code-intelligence.md`（CBM 主 + graphify 进阶） |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `.claude/rules/git-workflow.md` |
| Gitee Issue / MCP 工具 | `.claude/rules/issue-tracker.md` |
| 架构决策记录 | `docs/adr/` |

> 编码规范的**唯一权威来源是 `README.md` §5**，本文件**不复述**规范细则，避免双份漂移。下面只列结构性约束（稳定、不易腐化）。改后端代码前必读 §5。

## 技术栈基线（约束：构成，版本以代码为准）

- 构成：Spring Boot + Spring Cloud + Spring Cloud Alibaba（Nacos 注册/配置 + Gateway + Sentinel 限流）、MyBatis-Plus（分页/乐观锁/逻辑删除）、动态多数据源、Dubbo、Redisson、Hutool、Fastjson2、Vavr。
- **精确版本号不在本文复述**——统一在 `blue-whale-parent/pom.xml` 锁定；内部模块版本统一为 `blue-whale-parent.version`，新模块 parent 指向 `blue-whale-parent`。

## 模块拓扑（约束：分层与对外入口）

- **网关是唯一对外入口**：`blue-whale-gateway`，负责路由 + Nacos 服务发现 + Sentinel 限流 + JWT 过滤。前端与外部一律经网关访问业务服务，**不直连业务端口**。
- 公共基础设施集中在 `blue-whale-parent/`（`blue-whale-global` / `blue-whale-security` / `blue-whale-common-*`），跨服务共享。
- 业务服务：
  - `blue-whale-user`：用户服务（`user-api` 接口/DTO + `user-service` 实现 + 启动类）。
  - `blue-whale-agent`：按 `agent-api`（对外接口/DTO/RPC）+ `agent-service`（实现 + 启动类）拆分。
- `blue_whale_server/` 下**无根聚合 pom**，各模块均以 `blue-whale-parent` 为 parent。

## 配置与运行依赖（约束）

- **Nacos**：gateway 强依赖（注册 + 配置），地址/namespace/group 见 `blue-whale-gateway/bootstrap.yml`。
- **MySQL**：agent-service 强依赖，配置直写在 `blue-whale-agent-service/application.yml`（不走 Nacos）。
- **Redis**：分布式锁 / 缓存 / 接口幂等，多实例共享（Redisson + Spring Data Redis）。
- 本地完整运行至少需：**Nacos + MySQL + Redis**。

## 启动类模式（约束：新服务按此起步）

- `@SpringBootApplication` + `@MapperScan("com.blue.whale.**.mapper")`。
- 新增业务服务：独立 Spring Boot 模块，parent 指向 `blue-whale-parent`，按需依赖 `blue-whale-global` / `blue-whale-common-*`。

## 构建命令（约束：构建方式）

```bash
cd blue_whale_server
# 全量编译并装到本地仓库（先 parent 再业务）
mvn clean install -DskipTests

# 单独打包 agent-service（-am 带上依赖模块）
mvn clean package -pl blue-whale-agent/blue-whale-agent-service -am
```

单服务运行：在对应 `*-service` 模块执行其 `*Application.main()`（IDE 启动即可，配置走对应 `application.yml`/`bootstrap.yml`）。

---

## agent 高频红线（违反最多，细则见 `README.md` §5 对应小节）

1. **禁裸 `QueryWrapper`** → `LambdaQueryWrapper` + 方法引用（§5.5）。
2. **禁 N+1**（循环内单条查）→ 收集 id 批量查 + `Map` join（§5.5）。
3. **事务内禁外部 API/RPC 调用** → 事务后异步 `afterCommit`，防连接池打满（§5.8）。
4. **`@Async` 必指定命名线程池**（如 `@Async(AsyncConfig.GENERATION_EXECUTOR)`），禁默认线程池（§5.9）。
5. **业务异常 `throw new GlobalException(SystemCode.XXX_CODE, msg)`**，禁吞异常 / 返 `null` 表示失败 / `Result.failed` 包魔法字符串（§5.3）。
6. **Controller 恒返 `Result<DTO>`**，禁泄漏 entity；路径 `/api/<service>/*` 走网关；`X-User-Id` 鉴权（§5.6）。
7. **Service 接口/Impl 分离**，构造注入（`@RequiredArgsConstructor` + `final`），禁字段 `@Autowired`（§5.7）。
8. **实体继承 `BaseEntity`**，审计字段由 `AuditMetaObjectHandler` 填充，代码不手动 set；并发更新靠 `@Version` 乐观锁（§5.5）。
