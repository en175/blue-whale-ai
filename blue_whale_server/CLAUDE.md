# 后端 blue_whale_server

**生产级高并发微服务工程**：功能设计须立足高并发 + 分布式场景，代码须严守本文件「编码规范」节——改后端代码前必读、严格遵守。

本文件在 agent 进入 `blue_whale_server/` 目录时自动加载。根 `CLAUDE.md` 只保留仓库总览与跨端协作约定。

> **元约束**：本文件承载**约束 + 导航 + 编码规范**。版本号、端口、namespace、数据库地址等具体值会随演进变化，**一律以代码为准**：版本基线见 `blue-whale-parent/pom.xml`，各服务配置见对应 `*-service` 的 `application.yml` 或 `bootstrap.yml`。文档与代码矛盾时，**当场修正本文件**。

## 路由表：后端场景去哪查

| 场景 | 去哪 |
|------|------|
| **编码规范**（分层/响应/异常/数据访问/事务/并发/命名） | **本文件「编码规范」节（严格遵守）** |
| agent 高频违反项（速查） | 本文件末「agent 高频红线」 |
| 代码理解（查结构/调用链/架构） | `.claude/rules/code-intelligence.md`（CBM 主 + graphify 进阶） |
| Gitee 工作流（提交/分支/PR/发布/worktree） | `.claude/rules/git-workflow.md` |
| Gitee Issue / MCP 工具 | `.claude/rules/issue-tracker.md` |
| 架构决策记录 | `docs/adr/` |

> 编码规范的**唯一权威来源是本文件「编码规范」节**，README 不复述，避免双份漂移。

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

# 编码规范（严格遵守）

## 总则

1. **网关是唯一对外入口**。业务 Controller 不处理跨域/鉴权/限流，这些归网关（Sentinel 限流、JWT 过滤）。
2. **约束优先于自由发挥**：能复用基类/工具/注解（`BaseEntity` / `Result` / `GlobalException` / `RedisUtil` / `@Idem` / `@Log`）就不自己造。
3. **无状态服务**：不在进程内堆业务状态（用户会话、任务进度），状态落 DB/Redis，保证多实例可水平扩。
4. **失败要响亮**：业务异常 `throw new GlobalException(code, msg)`，禁止吞异常、禁止返回 `null` 表示失败、禁止用 `Result.failed` 包魔法字符串绕过异常体系。
5. **命名**：类 PascalCase，方法/字段 camelCase，常量 UPPER_SNAKE，包全小写。DB 列下划线（`gmt_create`、`is_delete`），Java 字段 camelCase（`gmtCreate`），靠 MyBatis-Plus 驼峰映射，**不手写**。

## 分层架构与依赖方向

```
controller  →  service(接口)  →  service.impl  →  mapper
     ↑              ↑                                  |
     DTO/VO         entity  ←──────────────────────────┘
```

- **依赖方向单向**：Controller 只依赖 `service` 接口，不直接碰 mapper；ServiceImpl 依赖 mapper + entity。
- **Controller 薄、Service 厚**：Controller 只做参数接收 + 鉴权 + 调 service + 包 `Result`，不写业务逻辑。
- **跨服务调用走 Dubbo RPC**（`*-api` 暴露接口），不走 HTTP；HTTP 仅给前端/网关。

## 统一响应 `Result<T>`

所有 Controller 返回 `Result<T>`（`com.blue.whale.global.base.resp.Result`），结构 `{code, msg, data}`。

```java
// 成功
return Result.ok();                 // 无数据
return Result.ok(data);             // 带数据
// 失败（业务异常优先 throw GlobalException，而非手动构造 failed）
return Result.failed("xxx 失败");    // 仅当确需在 Controller 层直接返回失败时
return Result.failed(SystemCode.DATA_NOT_EXIST);  // 带 Error 枚举
```

- **HTTP 200 + 业务码**：HTTP 恒 200，成功失败靠 `code`（200=成功）。前端按 `code` 判断，不靠 HTTP 状态。
- `Result.failed(Error)` 会把 `error.data()` 塞进 `data` 字段。

## 异常处理 `GlobalException` + `Error`

- **业务异常一律 `throw new GlobalException(code, msg)`**，由 `@RestControllerAdvice`（`RestExceptionConfig`）统一兜底转 `Result.failed`。
- 错误码用 `SystemCode.XXX_CODE` 常量（见「错误码分段」），不自创魔法数字。

```java
// 抛业务异常
throw new GlobalException(SystemCode.DATA_NOT_EXIST_CODE, "Skill 不存在: " + skillId);
throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "请登录后访问");

// 断言式（自定义枚举实现 Error 接口后可用 falseThrow / trueThrow）
SOME_ERROR.falseThrow(condition);   // condition=false 时抛
SOME_ERROR.trueThrow(condition);    // condition=true  时抛
```

- **DB 异常要暴露根因**：捕获 `DataAccessException` 时取 `getMostSpecificCause()` 拼 message，**禁止笼统返回「数据库未连接」掩盖真实问题**（见 `GenerationJobService#createImageJob`）。
- **不吞异常**：catch 后要么处理要么向上抛，空 catch 块禁止。

## 错误码分段（`SystemCode`）

错误码分段，**新增业务码落对应段，勿乱填**：

| 段 | 含义 | 示例 |
|---|---|---|
| `200` | 成功 | `SUCCESS_CODE` |
| `400` | 通用失败 | `FAILURE_CODE` |
| `401` | 未授权 | `UNAUTHORIZED_CODE` |
| `100xxx` | 参数/系统 | `PARAM_VALID_ERROR_CODE=100003`、`SYSTEM_BUSY_CODE=100010` |
| `1001xx` | 数据层 | `DATA_NOT_EXIST_CODE=100100`、`DATA_NO_PERMISSION_OPERATE_CODE=100105` |
| `1002xx` | 上游/资源 | `UPSTREAM_TIMEOUT_CODE=100200`、`ASSET_UNAVAILABLE_CODE=100202` |

- 新业务错误码：在 `SystemCode` 加枚举 + `public static final int XXX_CODE`，用限定名 `SystemCode.XXX_CODE` 引用（规避枚举构造期前向引用）。

## 实体与数据访问

### 实体继承 `BaseEntity`

所有 DB 实体继承 `com.blue.whale.global.base.entity.BaseEntity`，自动获得：

| 字段 | 列 | 特性 |
|---|---|---|
| `id` (Long) | `id` | `@TableId(IdType.AUTO)` 自增 |
| `gmtCreate` | `gmt_create` | `@TableField(fill=INSERT)` 插入填充 |
| `gmtModified` | `gmt_modified` | `@TableField(fill=INSERT_UPDATE)` |
| `version` (Integer) | `version` | `@Version` **乐观锁**，高并发更新自动带条件 |
| `deleted` (Boolean) | `is_delete` | `@TableLogic` **逻辑删除**，查询自动过滤 |

- 审计字段由 `AuditMetaObjectHandler` 自动填充，**代码里不手动 set `gmtCreate`/`version`/`deleted`**。
- 删除走逻辑删除（`deleteById` 实际 `update is_delete=1`），**无特殊理由不物理删**。

### 查询用 `LambdaQueryWrapper`（禁裸 `QueryWrapper`）

```java
LambdaQueryWrapper<Skill> w = new LambdaQueryWrapper<Skill>()
        .eq(Skill::getSource, "official")
        .and(StringUtils.hasText(keyword), q -> q.like(Skill::getName, keyword).or().like(Skill::getDescription, keyword))
        .orderByAsc(Skill::getSortOrder);
IPage<Skill> result = skillMapper.selectPage(new Page<>(pageNum, pageSize), w);
```

- **方法引用**（`Skill::getName`）而非字符串列名，重构安全。
- **条件构造用 `condition` 重载**：`.eq(hasKeyword, Skill::getName, kw)` 而非 `if(hasKeyword) w.eq(...)`。
- **排除大字段**：含 `content`/`md` 等大列的表，列表查询显式排除：`.select(Skill.class, info -> !info.getColumn().equals("content"))`。
- **N+1 禁忌**：列表 + 关联数据，先收集 id 批量查（`selectBatchIds` / `.in(...)`）建 `Map`，再内存 join（见 `GenerationJobService#listJobs`、`SkillServiceImpl#listMine`）。**禁止循环内单条查询**。

### 分页

- `new Page<>(current, size)` + `selectPage`，`PaginationInnerInterceptor` 已全局配置。
- 默认页大小合理（列表类 20~50），**前端可传但后端必设上限**（防恶意大页拖库）。
- 返回 `Page<DTO>`（不是 `Page<Entity>`），Controller 层 entity 不外泄。

## Controller 规范

```java
@Tag(name = "技能面板接口", description = "library / mine / auto")
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/agent/skills")
public class SkillController {
    private final SkillService skillService;

    @PostMapping("/library")
    public Result<Page<SkillLibraryDto>> library(
            @RequestHeader(value = "X-User-Id", required = false) Long userId,
            @RequestBody(required = false) SkillLibraryQuery query) {
        return Result.ok(skillService.listLibrary(requireUserId(userId),
                query == null ? new SkillLibraryQuery() : query));
    }

    private Long requireUserId(Long userId) {
        if (userId == null) {
            throw new GlobalException(SystemCode.UNAUTHORIZED_CODE, "请登录后访问");
        }
        return userId;
    }
}
```

- **路径前缀 `/api/agent/*`**（agent 服务），统一走网关转发。user 服务 `/api/auth/*`、`/api/user/*`、`/api/me`。
- **用户身份走 `X-User-Id` 请求头**（`Long`，网关 JWT 过滤后下发），`required=false` + 私有 `requireUserId()` 抛 401。MVP 无强鉴权时前端直传，正式鉴权在网关侧。
- **类注解三件套**：`@RestController` + `@RequiredArgsConstructor`（构造注入，`final` 字段）+ `@Tag`（Swagger 文档）。
- **返回恒 `Result<T>`**，`T` 用 DTO/VO，**禁止返回 entity**。
- **路径变量 `{id}` 用 Long**，与 `BaseEntity.id` 一致。
- **写操作加 `@Idem`** 防重复提交（见「并发与分布式」）。

## Service / Impl 规范

- **接口 + 实现分离**：接口在 `service` 包（`SkillService`），实现在 `service.impl` 包（`SkillServiceImpl`，`@Service`）。Controller 注入**接口类型**。
- **构造注入**：`@RequiredArgsConstructor` + `private final XxxMapper`，**禁字段注入 `@Autowired`**。
- **事务在 Impl 层**：写多表/需原子性的方法加 `@Transactional`（见「事务规范」），接口不带事务注解。
- **私有校验方法**前置：`requireXxx()` 查不到抛 `GlobalException(DATA_NOT_EXIST_CODE)`。
- 实现类带 `@Slf4j` 需打日志时；业务关键节点 `log.info`，异常 `log.error("xxx 异常", e)`（带堆栈）。

> 历史类（如 `GenerationJobService` 直接是 `@Service` 类）可逐步迁到接口/Impl 分离，新 service **默认分离**。

## 事务规范（`@Transactional`）

```java
@Transactional
public CreateJobResponse createVideoJob(VideoGenerateRequest req, Long userId) { ... }
```

- **写多表/写后读一致性**的方法加 `@Transactional`。
- **事务内禁跨进程调用**：事务内调外部 API（Ark/HTTP/RPC）会**长时间持库连接**，高并发下连接池打满。模式：事务内只落 DB，**事务提交后才发外部请求/异步任务**。
- **事务后异步**：事务提交后才触发 `@Async`，保证 insert 已落库可见：

```java
if (TransactionSynchronizationManager.isSynchronizationActive()) {
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
        @Override public void afterCommit() { asyncService.doAsync(jobId); }
    });
} else {
    asyncService.doAsync(jobId);  // 无事务上下文直接调
}
```

- **`@Transactional` 不要加在 private 方法上**（不生效）；同类内部方法调用也不走代理（绕过事务）。
- **只读查询**用 `@Transactional(readOnly = true)` 可选优化，非强制。

## 并发与分布式

### 分布式锁（Redisson + RedisUtil）

- 多实例下**进程内锁（`synchronized`/`ReentrantLock`）对跨实例竞争无效**，分布式场景用 Redisson 分布式锁。
- 锁粒度细：锁 key 带业务 id（`RedisUtil.key("order", userId)`），**禁全局粗锁**。
- `blue-whale-common-redis` 提供 `RedisUtil`（静态工具：`setCacheObject`/`getCacheObject`/`delete`/`expire`/`key(...)`）+ Redisson 锁切面。优先用封装，**禁手写 `setnx`**。
- 锁必须有**超时**（防死锁），用完即释（try-finally）。

### 接口幂等 `@Idem`

```java
@Idem                       // 默认 2000ms 内重复提交失效
@PostMapping("/library/{id}/add")
public Result<Void> add(...) { ... }

@Idem(expire = 5000)        // 自定义窗口
```

- 写接口（下单/提交/支付）加 `@Idem`，防用户连点/网络重试导致的重复写入。

### 线程池隔离

- **耗时任务（调上游 API、生成、转码）走专用线程池，不阻塞 Servlet 请求线程**。
- 用 `@Async(AsyncConfig.GENERATION_EXECUTOR)` 指定命名线程池，**禁用默认 `@Async`**（默认走 `SimpleAsyncTaskExecutor`，无上限无限建线程，高并发下线程爆炸）。
- 线程池参数显式设：core/max/queue/拒绝策略/优雅关停（见 `AsyncConfig`：core=2/max=8/queue=100 + `waitForTasksToCompleteOnShutdown`）。
- 定时任务用 `@EnableScheduling` + `@Scheduled`（如 `JobPoller` 轮询上游任务）。

### 缓存

- Redis 缓存热点读，**必设过期时间**（`setCacheObject(key, val, timeout, unit)`），防脏数据永久驻留。
- 写 DB 后**主动失效缓存**（先更 DB 后删缓存），不依赖过期兜底。
- 大 value 拆分；禁把超大集合整体塞 Redis。

## 参数校验

- 字段级校验用 `@Limit`（`com.blue.whale.web.valid.annotation.Limit`，**枚举/范围校验，javax.validation Constraint**，非限流）+ JSR-303（`@NotNull`/`@NotBlank`/`@Size` 等）。
- Controller 加 `@Validated`，DTO 字段加约束注解，校验失败由全局 Advice 转 `Result.failed(PARAM_VALID_ERROR_CODE)`。
- **注意区分**：`@Limit` = 参数值校验；**限流** = 网关 Sentinel（`blue-whale-gateway` 的 flow/degrade 规则），不在业务服务做。

## 日志

- 用 Lombok `@Slf4j` + `slf4j` API，**禁直接 `System.out`**、禁 `java.util.logging`。
- 关键操作打 `@Log`（`com.blue.whale.tool.log.annotation.Log`，切面自动记录方法/入参/耗时）。
- 日志级别：正常流程 `info`，调试 `debug`，异常 `error("描述", e)` **必带异常对象**（打堆栈）。
- **日志禁打敏感信息**（密码、token、完整身份证/手机号），脱敏后再打。
- 占位符 `{}` 而非字符串拼接（`log.info("job {} succeeded", jobId)`）。

## 序列化与 JSON 命名

- **HTTP 对外 JSON 字段 camelCase**（`skillId`/`coverUrl`/`gmtCreate`）。后端**未配** `spring.jackson.property-naming-strategy: SNAKE_CASE`，字段按 Java 原样输出。前端按 camelCase 对齐。
- Redis 值序列化用 **FastJson2**（`FastJsonRedisSerializer`，`RedisUtil` 已配）。
- 实体字段如果需要与 JSON 名解耦，用 Jackson `@JsonProperty`，但**优先靠字段命名直接对齐**。

## 网关与路由

- 路由在 `blue-whale-gateway/bootstrap.yml`：`Path=/api/agent/**` → `lb://blue-whale-agent`，`/api/auth/**,/api/me,/api/user/**` → `lb://blue-whale-user`。服务发现走 Nacos。
- **网关侧职责**：路由 + JWT 鉴权过滤（`JwtAuthGlobalFilter`，下发 `X-User-Id`/`X-Phone`）+ Sentinel 限流 + 全局 CORS。
- 业务服务**不重复实现** CORS / 鉴权 / 限流。
- 放行免登接口（如登录、验证码）在网关白名单配置，不在业务服务判断。

## 高并发 checklist（提 PR 前自查）

- [ ] 写多表方法有 `@Transactional`；事务内**无**外部 API/RPC 调用（异步/afterCommit 移出）。
- [ ] 耗时操作走**专用线程池** `@Async(命名 executor)`，未用默认 `@Async`。
- [ ] 跨实例竞争资源用**分布式锁**（Redisson），锁 key 带业务 id、有超时、try-finally 释放。
- [ ] 写接口加 `@Idem` 防重复提交。
- [ ] 列表查询**无 N+1**（批量查 + Map join）；大字段已排除；分页有上限。
- [ ] 缓存有**过期时间**，写 DB 后主动失效。
- [ ] 实体继承 `BaseEntity`；并发更新靠 `@Version` 乐观锁，非 `select-then-update` 竞态。
- [ ] 业务异常 `throw GlobalException(SystemCode.XXX_CODE, msg)`，错误码落对应段；DB 异常暴露根因。
- [ ] Controller 返回 `Result<DTO>`，未泄漏 entity；路径 `/api/<service>/*`；`X-User-Id` 鉴权。
- [ ] 日志用 `@Slf4j`，异常带堆栈，无敏感信息。

---

## agent 高频红线（违反最多，细则见上文「编码规范」对应小节）

1. **禁裸 `QueryWrapper`** → `LambdaQueryWrapper` + 方法引用（实体与数据访问）。
2. **禁 N+1**（循环内单条查）→ 收集 id 批量查 + `Map` join（实体与数据访问）。
3. **事务内禁外部 API/RPC 调用** → 事务后异步 `afterCommit`，防连接池打满（事务规范）。
4. **`@Async` 必指定命名线程池**（如 `@Async(AsyncConfig.GENERATION_EXECUTOR)`），禁默认线程池（并发与分布式）。
5. **业务异常 `throw new GlobalException(SystemCode.XXX_CODE, msg)`**，禁吞异常 / 返 `null` / `Result.failed` 包魔法字符串（异常处理）。
6. **Controller 恒返 `Result<DTO>`**，禁泄漏 entity；路径 `/api/<service>/*` 走网关；`X-User-Id` 鉴权（Controller 规范）。
7. **Service 接口/Impl 分离**，构造注入（`@RequiredArgsConstructor` + `final`），禁字段 `@Autowired`（Service / Impl 规范）。
8. **实体继承 `BaseEntity`**，审计字段由 `AuditMetaObjectHandler` 填充，代码不手动 set；并发更新靠 `@Version` 乐观锁（实体与数据访问）。
