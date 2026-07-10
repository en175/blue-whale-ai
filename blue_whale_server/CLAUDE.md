# 后端 blue_whale_server

本文件在 agent 进入 `blue_whale_server/` 目录时自动加载。根 `CLAUDE.md` 只保留仓库总览与跨端协作约定。

> **元约束**：本文件只承载**约束**与**导航**，不是事实手册。版本号、端口、namespace、数据库地址等具体值会随版本演进，**一律以代码为准**：版本基线见 `blue-whale-parent/pom.xml`，各服务端口/配置见对应 `*-service` 模块的 `application.yml` 或 `bootstrap.yml`。发现文档与代码矛盾时，**当场修正本文件**。

## 技术栈基线（版本以代码为准）
- 技术栈构成：Spring Boot + Spring Cloud + Spring Cloud Alibaba（Nacos 注册/配置 + Gateway + Sentinel）、MyBatis-Plus + 动态多数据源、Dubbo、Redisson、Hutool、Fastjson2、Vavr。
- **精确版本号不在本文复述**——统一在 `blue-whale-parent/pom.xml` 锁定；内部模块版本统一为 `blue-whale-parent.version`。

## 模块拓扑（约束：分层与对外入口）
- **网关是唯一对外入口**：`blue-whale-gateway`，负责路由、Nacos 服务发现、Sentinel 限流。前端与外部一律经网关访问业务服务，不直连。
- 公共基础设施集中在 `blue-whale-parent/`（`blue-whale-global` / `blue-whale-security` / `blue-whale-common-*`），跨服务共享。
- 业务服务：
  - `blue-whale-user`：用户服务，独立 Spring Boot 模块。
  - `blue-whale-agent`：按 `*-api`（对外接口/DTO）+ `*-service`（实现 + 启动类）拆分：
    - `blue-whale-agent-api`：接口定义层，当前为空模块，按需放入对外 DTO / RPC 接口。
    - `blue-whale-agent-service`：业务实现层，启动类 `AgentApplication`，端口见 `application.yml`。
- **注意**：`blue_whale_server/` 下无根聚合 `pom.xml`，`blue-whale-parent`、`blue-whale-gateway`、`blue-whale-user`、`blue-whale-agent/blue-whale-agent-service` 等模块均以 `blue-whale-parent` 为 parent。各服务实际端口/角色对照，见对应模块配置文件（不在此固化，避免随部署变化腐化）。

## 配置与运行依赖（约束）
- **Nacos 是 gateway 的强依赖**：`blue-whale-gateway` 的服务注册与配置都依赖 Nacos，地址/namespace/group 见 `bootstrap.yml`。
- **MySQL 是 agent-service 的强依赖**：数据库连接配置目前直接写在 `blue-whale-agent-service/src/main/resources/application.yml` 中（不走 Nacos），地址/库名/账号以代码为准。
- 本地完整运行至少需：Nacos（gateway 用）+ MySQL（agent-service 用）。

## 启动类模式（约束：新服务按此起步）
- `blue-whale-agent-service` 启动类：`@SpringBootApplication` + `@MapperScan("com.blue.whale.agent.**.mapper")`。
- 新增业务服务按现有模式起步：独立 Spring Boot 模块，parent 指向 `blue-whale-parent`，依赖按需引入 `blue-whale-global` / `blue-whale-common-*`。

## 构建命令（约束：构建方式）
```bash
cd blue_whale_server
# 全量编译并装到本地仓库（先 parent 再业务）
mvn clean install -DskipTests

# 单独打包 agent-service（-am 带上依赖模块）
mvn clean package -pl blue-whale-agent/blue-whale-agent-service -am
```
单服务运行：在对应 `*-service` 模块执行其 `*Application.main()`（IDE 启动即可，配置走对应 `application.yml`/`bootstrap.yml`）。
