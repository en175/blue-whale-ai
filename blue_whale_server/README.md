# blue-whale-server（Agent 编排后端）

Blue-Whale 的后端服务，Java 21 + Spring Boot 3.5.x 单服务，为后续「编排 agent」业务与 LLM 框架选型打底。

> 工程目录保留下划线 `blue_whale_server/`（hook 路径与 `blue_whale_web/` 对称约定不动），Maven artifactId 为 `blue-whale-server`。

## 技术栈

| 组件 | 版本 | 说明 |
|---|---|---|
| JDK | 21 (LTS) | |
| Spring Boot | 3.5.x | Boot 3 末代行，Java 21 最稳；不上 Boot 4（要 Java 25） |
| MyBatis-Plus | 3.5.16 | `mybatis-plus-spring-boot3-starter`（Boot3 专用坐标）+ `mybatis-plus-jsqlparser`（分页/乐观锁插件依赖） |
| MySQL | connector-j（Boot BOM 管理） | |
| 序列化 | 默认 Jackson | 不引 fastjson2 |
| Lombok | provided | |
| 构建 | Maven Wrapper（`./mvnw`） | 不依赖全局 mvn |

分层借鉴参考工程 `sweet-oa-java`，裁掉其 Nacos / Dubbo / OAuth2 / 网关 / 多租户 / Redis / Spring Security（后者后定）。

## 工程结构（单 Maven 模块 + 包分层）

```
blue_whale_server/
├── pom.xml
├── mvnw / mvnw.cmd / .mvn/wrapper/   # Maven Wrapper
└── src/
    ├── main/
    │   ├── java/com/bluewhale/agent/
    │   │   ├── AgentApplication.java        # 启动类（仅 @SpringBootApplication）
    │   │   ├── common/                      # resp / exception / entity / handler / web
    │   │   ├── config/                      # MybatisPlusConfig（分页+乐观锁+@MapperScan）、WebAppConfig（CORS）
    │   │   ├── controller/                  # HealthController
    │   │   ├── model / service / mapper/    # 预留空包，业务后填
    │   └── resources/
    │       ├── application.yml              # 端口 8000、mybatis-plus 配置
    │       ├── application-dev.yml          # 本地 MySQL datasource
    │       ├── mapper/                      # MyBatis XML（预留空）
    │       └── logback-spring.xml
    └── test/java/.../controller/HealthControllerTest.java
```

公共能力（`common/`）：

- `resp/Result` + `SystemCode` + `IResultCode`：统一返回壳（`code`/`msg`/`data`，`ok()`/`failed()` 工厂）。
- `exception/Error` + `GlobalException`：断言式业务异常（`falseThrow`/`trueThrow`）。
- `web/RestExceptionConfig`：`@RestControllerAdvice` 把异常 / 校验错误统一转成 `Result.failed`。
- `entity/BaseEntity`：`id` / `gmtCreate` / `gmtModified` / `version`（`@Version`）/ `deleted`（`@TableLogic`）。
- `handler/AuditMetaObjectHandler`：审计字段自动填充。

## 前置条件

- **JDK 21**（本机 `java -version` 须为 21）。
- **本地 MySQL**（仅 `spring-boot:run` 实跑时需要；`mvn test` 用 `@WebMvcTest`，不起 DataSource，不需 MySQL）。dev profile 默认连 `localhost:3306/blue_whale`，账号 `root/root`（见 `application-dev.yml`，按本机改）。

## 构建 / 运行

```bash
# 编译（不跑测试）
./mvnw -q clean compile

# 跑测试（无需 MySQL）
./mvnw test

# 实跑（需本地 MySQL 已起、库已建）
./mvnw spring-boot:run
```

## 对外契约

- **端口**：8000。
- **健康探活**：`GET /health` → `{"status":"ok"}`（裸返回，不包 `Result`，对齐前端 / 部署探活）。
- **CORS**：放行 `http://localhost:3000`、允许凭证（前端 `blue_whale_web` dev 端口）。

## 验证

```bash
curl http://localhost:8000/health        # → {"status":"ok"}
curl -i -X OPTIONS http://localhost:8000/health \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: GET'  # 应返回 CORS 头
```

## 不在本脚手架范围（后续另起工单）

agent 业务建模 + 编排框架选型（Spring AI / LangChain4j / 自研）、Spring Security、`@Log`、i18n、Redis。脚手架只把基础设施与分层搭好，不建业务表 / CRUD。
