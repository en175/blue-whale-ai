# blue_whale_server（Blue-Whale 后端微服务）

Blue-Whale 后端：Spring Cloud 微服务体系，**网关为唯一对外入口**，业务经网关路由到各服务。本文是工程现状说明（技术栈 / 模块 / 运行依赖 / 构建）。

> 元约束：版本号、端口、namespace、库地址会随演进变化，**一律以代码为准**——版本基线见 `blue-whale-parent/pom.xml`，各服务配置见对应 `*-service` 的 `application.yml` 或 `bootstrap.yml`。文档与代码矛盾时，改文档不改代码的事实。

> **编码规范见 [`CLAUDE.md`](CLAUDE.md)「编码规范」节**（后端 agent 自动加载的工作约束，改后端代码前必读、严格遵守）。本文不复述规范，避免双份漂移。

---

## §1 项目定位

- **多模块微服务**（不是单服务）。对外唯一入口是网关 `blue-whale-gateway`，前端/外部一律经网关访问业务服务，**不直连业务端口**。
- 面向**高并发、分布式**场景：服务多实例无状态部署、Redis 做分布式协调、MySQL 持久化、Nacos 注册/配置。
- 公共基础设施集中在 `blue-whale-parent/`，跨服务共享；业务服务按需依赖。

## §2 技术栈基线（版本以 `blue-whale-parent/pom.xml` 为准）

| 组件 | 说明 |
|---|---|
| JDK | **17**（parent 锁定，勿升 21+ 除非 parent 同步） |
| Spring Boot | 3.x（Boot3） |
| Spring Cloud | 2021.0.4 + Alibaba 2021.0.4.0（Nacos 注册/配置 + Gateway + Sentinel） |
| MyBatis-Plus | 3.5.3.1（分页/乐观锁/逻辑删除插件 + `LambdaQueryWrapper`） |
| Dubbo | 3.2.6（RPC，跨服务内部调用） |
| Redis | Redisson 客户端 + Spring Data Redis，**FastJson2** 序列化 |
| Fastjson2 | 2.0.40（Redis 值 + 内部 JSON，非 HTTP 对外） |
| Hutool | 5.8.16（工具集） |
| Lombok | provided（`@Getter/@Setter/@RequiredArgsConstructor/@Accessors(chain)`） |

> 内部模块版本统一为 `blue-whale-parent.version`，新模块 parent 指向 `blue-whale-parent`。

## §3 模块拓扑

```
blue_whale_server/
├── blue-whale-parent/                 # 公共父 + 共享基础设施
│   ├── blue-whale-global/             # BaseEntity / Result / SystemCode / GlobalException / Error
│   ├── blue-whale-security/           # 鉴权/安全
│   ├── blue-whale-common-web/         # Web 配置 / CORS / @Limit 校验 / 全局异常 Advice
│   └── blue-whale-common-tool/
│       ├── blue-whale-common-redis/   # RedisUtil / Redisson 分布式锁切面
│       ├── blue-whale-common-log/     # @Log 日志切面
│       ├── blue-whale-common-idem/    # @Idem 幂等切面
│       └── ...                        # fastjson2 / type-handler / dubbo-rpc / module 等
├── blue-whale-gateway/                # 网关：路由 + Nacos 发现 + Sentinel 限流 + JWT 过滤
├── blue-whale-user/                   # 用户服务（user-api + user-service）
└── blue-whale-agent/                  # Agent 编排服务（agent-api 接口/DTO + agent-service 实现+启动）
```

- **agent / user** 按 `*-api`（对外接口、DTO、RPC 接口）+ `*-service`（实现 + 启动类 `*Application`）拆分。
- `blue_whale_server/` 下**无根聚合 pom**，各模块均以 `blue-whale-parent` 为 parent。
- 启动类模式：`@SpringBootApplication` + `@MapperScan("com.blue.whale.**.mapper")`。

## §4 运行依赖

- **Nacos**：gateway 的强依赖（注册 + 配置）。地址/namespace/group 见 `blue-whale-gateway/bootstrap.yml`。
- **MySQL**：agent-service 强依赖，配置在 `blue-whale-agent-service/application.yml`（不走 Nacos）。
- **Redis**：分布式锁 / 缓存 / 幂等，多实例共享。
- 本地完整运行至少需：Nacos + MySQL + Redis。

---

## 构建与运行

```bash
cd blue_whale_server

# 全量编译装本地仓库（先 parent 再业务）
mvn clean install -DskipTests

# 单独打包 agent-service（-am 带依赖模块）
mvn clean package -pl blue-whale-agent/blue-whale-agent-service -am
```

单服务运行：在对应 `*-service` 模块执行其 `*Application.main()`（IDE 启动，配置走对应 yml）。

## 关联文档

- **后端编码规范 + agent 约束**：[`CLAUDE.md`](CLAUDE.md)（改后端代码前必读）
- 工作流（分支/PR/发布/worktree）：仓库根 `docs/agents/git-workflow.md`
- Gitee Issue / MCP：`.claude/rules/issue-tracker.md`
- 代码理解工具（CBM + graphify）：`docs/agents/code-intelligence.md`
- 架构决策记录（ADR）：`docs/adr/`
