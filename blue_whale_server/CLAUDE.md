# 后端 blue_whale_server

生产级高并发微服务工程。改后端代码前必读本文件「编码规范」并严格遵守。

> **元约束**：本文件承载**约束 + 导航 + 编码规范**。版本号、端口、namespace、DB 地址等具体值以代码为准——版本基线见 `blue-whale-parent/pom.xml`，服务配置见对应 `*-service` 的 `application.yml`/`bootstrap.yml`。文档与代码矛盾时**当场修正本文件**。

## 路由表：后端场景去哪查

| 场景 | 去哪 |
|------|------|
| **编码规范**（分层/响应/异常/数据访问/事务/并发） | **本文件「编码规范」节（严格遵守）** |
| agent 高频违反项（速查） | 本文件末「agent 高频红线」 |
| 代码理解（查结构/调用链/架构） | `.claude/rules/code-intelligence.md`（CBM 主 + graphify 进阶） |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `.claude/rules/git-workflow.md` |
| Gitee Issue / MCP 工具 | `.claude/rules/issue-tracker.md` |
| 架构决策记录 | `docs/adr/` |

## 技术栈与模块（构成约束，版本以代码为准）

- **栈**：Spring Boot + Spring Cloud + Spring Cloud Alibaba（Nacos 注册/配置 + Gateway + Sentinel）、MyBatis-Plus、动态多数据源、Dubbo、Redisson、Hutool、Fastjson2、Vavr。版本统一在 `blue-whale-parent/pom.xml`，内部模块版本 = `blue-whale-parent.version`。
- **网关是唯一对外入口**：`blue-whale-gateway`，负责路由 + Nacos 发现 + Sentinel 限流 + JWT 过滤。前端/外部一律经网关，**不直连业务端口**。
- **公共基建**集中在 `blue-whale-parent/`（`blue-whale-global` / `blue-whale-security` / `blue-whale-common-*`）。
- **业务服务**：`blue-whale-user`（user-api/user-service）、`blue-whale-agent`（agent-api/agent-service）。均以 `blue-whale-parent` 为 parent；`blue_whale_server/` 下**无根聚合 pom**。
- **运行依赖**：Nacos（gateway 强依赖）、MySQL（agent-service 直连，配置在 application.yml）、Redis（锁/缓存/幂等，多实例共享）。本地完整运行至少需 Nacos + MySQL + Redis。启动类：`@SpringBootApplication` + `@MapperScan("<服务包>.**.mapper")`（agent 扫 `com.blue.whale.agent.**.mapper`；user 扫 `com.blue.whale.user.mapper`）。

## 构建命令

```bash
cd blue_whale_server
mvn clean install -DskipTests                                          # 全量（先 parent 再业务）
mvn clean package -pl blue-whale-agent/blue-whale-agent-service -am    # 单服务（-am 带依赖模块）
```

单服务运行：在对应 `*-service` 跑其 `*Application.main()`，配置走对应 `application.yml`/`bootstrap.yml`。

---

# 编码规范（严格遵守）

## 总则

1. **网关是唯一对外入口**。业务 Controller 不处理跨域/鉴权/限流（归网关：Sentinel、JWT、CORS）。
2. **约束优先**：能复用基类/工具/注解（`BaseEntity`/`Result`/`GlobalException`/`RedisUtil`/`@Idem`/`@Log`）就不自己造。
3. **无状态服务**：业务状态落 DB/Redis，不堆进程内（会话、进度），保证可水平扩。
4. **失败要响亮**：业务异常 `throw new GlobalException(code, msg)`，禁吞异常 / 返 `null` 表示失败 / `Result.failed` 包魔法字符串。
5. **命名**：类 PascalCase，方法/字段 camelCase，常量 UPPER_SNAKE，包全小写。DB 列下划线（`gmt_create`），Java 驼峰（`gmtCreate`），靠 MyBatis-Plus 映射，**不手写**。

## 分层架构

```
controller → service(接口) → service.impl → mapper
     ↑           ↑                                  |
   DTO/VO     entity  ←──────────────────────────────┘
```

- **依赖单向**：Controller 只依赖 service 接口，不碰 mapper；Impl 依赖 mapper + entity。
- **Controller 薄、Service 厚**：Controller 只接收参数 + 调 service + 包 `Result`，不写业务。
- **跨服务走 Dubbo RPC**（`*-api` 暴露接口），不走 HTTP；HTTP 仅给前端/网关。

## 统一响应 `Result<T>`

所有 Controller 返回 `Result<T>`（`com.blue.whale.global.base.resp.Result`），结构 `{code,msg,data}`。

```java
return Result.ok(data);                                      // 成功
throw new GlobalException(SystemCode.XXX_CODE, "msg");       // 失败优先抛异常
return Result.failed(SystemCode.DATA_NOT_EXIST);             // 仅 Controller 确需直接返失败
```

**HTTP 恒 200 + 业务码**：成功失败靠 `code`（200=成功），前端按 `code` 判断，不靠 HTTP 状态。

## 异常与错误码

- 业务异常一律 `throw new GlobalException(code, msg)`，由 `@RestControllerAdvice`（`RestExceptionConfig`）兜底转 `Result.failed`。错误码用 `SystemCode.XXX_CODE` 常量，**不自创魔法数字**。分段：

| 段 | 含义 | 示例 |
|---|---|---|
| 200 / 400 / 401 | 成功 / 通用失败 / 未授权 | `SUCCESS_CODE` / `FAILURE_CODE` / `UNAUTHORIZED_CODE` |
| 100xxx | 参数/系统 | `PARAM_VALID_ERROR_CODE=100003`、`SYSTEM_BUSY_CODE=100010` |
| 1001xx | 数据层 | `DATA_NOT_EXIST_CODE=100100`、`DATA_NO_PERMISSION_OPERATE_CODE=100105` |
| 1002xx | 上游/资源 | `UPSTREAM_TIMEOUT_CODE=100200`、`ASSET_UNAVAILABLE_CODE=100202` |

- **DB 异常暴露根因**：catch `DataAccessException` 取 `getMostSpecificCause()` 拼 message，禁笼统返"数据库未连接"。**禁空 catch**。
- **错误码即断言（复用 `Error` 接口）**：`SystemCode`（经 `IResultCode extends Error`）自带 `falseThrow(cond)` / `trueThrow(cond)` / `exception()` / `msgEx()`——`SystemCode.DATA_NOT_EXIST.falseThrow(exists)`（cond=false 抛）、`SystemCode.DATA_EXISTED.trueThrow(exists)`（cond=true 抛）、`throw SystemCode.UPSTREAM_TIMEOUT_CODE.exception()`、`msgEx("自定义消息")`。比手写 `if (x) throw new GlobalException(...)` 简洁，错误码即枚举常量，不自创魔法数字。

## 实体与数据访问

- **实体继承 `BaseEntity`**（`com.blue.whale.global.base.entity.BaseEntity`，所有 agent 实体均 `extends`）：自动获 `id`（`@TableId AUTO`）、`gmtCreate`/`gmtModified`（自动填充）、`version`（`@Version` 乐观锁）、`deleted`（`@TableLogic` 逻辑删除）。审计字段由 `IMetaObjectHandler`（`blue-whale-common-mybatis-plus`）填充，**代码不手动 set**。删除走逻辑删除，无特殊理由不物理删。
- **查询用 `LambdaQueryWrapper`**（禁裸 `QueryWrapper`）：方法引用（`Skill::getName`）非字符串列名；条件用 `condition` 重载（`.eq(hasKw, Skill::getName, kw)`）；大字段列表查询显式排除（`.select(Skill.class, i -> !i.getColumn().equals("content"))`）。
- **禁 N+1**：列表 + 关联先收集 id 批量查（`selectBatchIds`/`.in(...)`）建 `Map` 再内存 join，**禁循环内单条查**。
- **分页**：`new Page<>(current,size)` + `selectPage`，前端可传 size 但后端**必设上限**。返回 `Page<DTO>`，entity 不外泄。

## Controller 规范

```java

@Tag(name="技能面板") @RestController @RequiredArgsConstructor
@RequestMapping("/api/agent/skills")
public class SkillController {
    private final SkillService skillService;

    @PostMapping("/library")
    public Result<Page<SkillLibraryDto>> library(
            @RequestHeader(value="X-User-Id", required=false) Long userId,
            @RequestBody(required=false) SkillLibraryQuery query) {
        return Result.ok(skillService.listLibrary(requireUserId(userId),
                query == null ? new SkillLibraryQuery() : query));
    }
    private Long requireUserId(Long userId) {            // required=false + 私有校验抛 401
        if (userId == null) throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "请登录后访问");
        return userId;
    }
}
```

- 路径前缀 `/api/<service>/*`（agent：`/api/agent/*`；user：`/api/auth/*`、`/api/user/*`、`/api/me`），统一走网关。
- **用户身份走 `X-User-Id` 请求头**（Long，网关 JWT 过滤后下发），`required=false` + 私有 `requireUserId()` 抛 401。
- 三件套：`@RestController` + `@RequiredArgsConstructor`（构造注入，`final` 字段）+ `@Tag`。返回恒 `Result<DTO>`，**禁返 entity**。写操作加 `@Idem`。

## Service / Impl

- **接口 + 实现分离**：接口在 `service` 包，实现在 `service.impl`（`@Service`），Controller 注入**接口类型**。
- **构造注入**：`@RequiredArgsConstructor` + `private final XxxMapper`，**禁字段 `@Autowired`**。
- **事务在 Impl 层**：写多表/原子性方法加 `@Transactional`，接口不带事务注解。关键节点 `log.info`，异常 `log.error("xxx", e)` 带堆栈。

## 事务规范

- **事务内禁跨进程调用**（外部 API/RPC/HTTP）——长时间持库连接，高并发打满连接池。事务内只落 DB，外部请求/异步任务在**提交后**发。
- **事务后异步**：`TransactionSynchronizationManager.registerSynchronization` 的 `afterCommit()` 触发 `@Async`，保证 insert 已落库可见。无事务上下文直接调。
- `@Transactional` 不加 private 方法 / 同类内部调用（不走代理，无效）。

## 并发与分布式

- **分布式锁（Redisson + RedisUtil）**：跨实例竞争用 Redisson（进程内锁对跨实例无效）。锁 key 带业务 id（`RedisUtil.key("order",userId)`），**禁全局粗锁**；有超时防死锁，try-finally 释放。**禁手写 setnx**。
- **接口幂等 `@Idem`**：写接口（下单/提交/支付）加 `@Idem`（默认 2000ms，`@Idem(expire=5000)` 自定义），防连点/重试重复写入。
- **线程池隔离**：耗时任务（调上游/生成/转码）走**专用命名线程池** `@Async(命名 executor)`，**禁默认 `@Async`**（`SimpleAsyncTaskExecutor` 无上限无限建线程）。参数显式设（core/max/queue/拒绝策略/优雅关停）。注意 `AsyncConfig.GENERATION_EXECUTOR`（core2/max8/queue100）**仅在 agent-service**，user-service 等需各自定义命名线程池，勿跨服务引用。
- **缓存**：Redis 缓存热点读，**必设过期**；写 DB 后主动失效（先更 DB 后删缓存）；大 value 拆分。

## 参数校验、日志、序列化

- **校验**：字段级用 `@Limit`（`com.blue.whale.web.valid.annotation.Limit`，枚举/范围校验，**非限流**）+ JSR-303（`@NotNull`/`@NotBlank`/`@Size`）。Controller 加 `@Validated`，失败由全局 Advice 转 `Result.failed(PARAM_VALID_ERROR_CODE)`。**限流在网关 Sentinel**，不在业务服务。
- **日志**：`@Slf4j` + slf4j，禁 `System.out`/`java.util.logging`。关键操作 `@Log`。正常 `info`，异常 `error("desc",e)` 必带异常对象。**禁打敏感信息**（密码/token/身份证/手机号），占位符 `{}` 非拼接。
- **JSON 命名**：HTTP 对外 JSON **camelCase**（`skillId`/`coverUrl`），字段按 Java 原样输出；**禁配** `spring.jackson.property-naming-strategy: SNAKE_CASE`（DB JSON 列需 snake 映射时给 `JacksonTypeHandler` 注入独立 ObjectMapper，见 ADR-0019）。Redis 值用 FastJson2（`FastJsonRedisSerializer`）。

## 网关与路由

- 路由在 `blue-whale-gateway/bootstrap.yml`：`/api/agent/**`→`lb://blue-whale-agent`，`/api/auth/**,/api/me,/api/user/**`→`lb://blue-whale-user`。
- 网关职责：路由 + JWT 鉴权（`JwtAuthGlobalFilter`，下发 `X-User-Id`/`X-Phone`）+ Sentinel 限流 + 全局 CORS。**业务服务不重复实现**。免登接口（登录/验证码）在网关白名单配置。

---

## 高并发 checklist（提 PR 前自查）

- [ ] 写多表方法有 `@Transactional`；事务内**无**外部 API/RPC（异步/afterCommit 移出）。
- [ ] 耗时操作走**专用线程池** `@Async(命名 executor)`，未用默认。
- [ ] 跨实例竞争用**分布式锁**（Redisson），key 带业务 id、有超时、try-finally 释放。
- [ ] 写接口加 `@Idem`。
- [ ] 列表查询**无 N+1**（批量查 + Map join）；大字段排除；分页有上限。
- [ ] 缓存有**过期**，写 DB 后主动失效。
- [ ] 实体继承 `BaseEntity`；并发更新靠 `@Version` 乐观锁。
- [ ] 业务异常 `throw GlobalException(SystemCode.XXX_CODE, msg)`；DB 异常暴露根因。
- [ ] Controller 返 `Result<DTO>`，未泄漏 entity；路径 `/api/<service>/*`；`X-User-Id` 鉴权。
- [ ] 日志 `@Slf4j`，异常带堆栈，无敏感信息。

---

## agent 高频红线（违反最多，细则见上文对应小节）

1. **禁裸 `QueryWrapper`** → `LambdaQueryWrapper` + 方法引用。
2. **禁 N+1**（循环内单条查）→ 收集 id 批量查 + `Map` join。
3. **事务内禁外部 API/RPC** → 事务后异步 `afterCommit`。
4. **`@Async` 必指定命名线程池**，禁默认。
5. **业务异常 `throw new GlobalException(SystemCode.XXX_CODE, msg)`**，禁吞异常/返 null/`Result.failed` 包魔法字符串。
6. **Controller 恒返 `Result<DTO>`**，禁泄漏 entity；路径 `/api/<service>/*`；`X-User-Id` 鉴权。
7. **Service 接口/Impl 分离**，构造注入（`@RequiredArgsConstructor` + `final`），禁字段 `@Autowired`。
8. **实体继承 `BaseEntity`**，审计字段自动填充不手 set；并发更新靠 `@Version`。
