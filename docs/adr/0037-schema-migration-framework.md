# ADR-0037：版本化数据库迁移与 Schema 就绪门禁

- **状态**：Accepted
- **日期**：2026-07-18
- **关联工单**：[IK1W1E](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK1W1E)

## 背景

本地完整 Compose 栈的数据库 Schema 漂移导致模板服务不可用（父工单 IK1VZR）。根因有三：

1. **无版本化迁移**：仓库存在按历史工单命名的 `ik*.sql` 增量脚本，但没有统一的版本顺序、
   迁移历史表或执行入口。开发者只能凭记忆手工按顺序执行，升级路径不可重复。
2. **MySQL entrypoint 只初始化空卷**：Compose 把 `schema.sql` 挂载到
   `docker-entrypoint-initdb.d`，MySQL 只在空数据卷首次启动时执行。已有命名卷不会自动升级，
   拉新分支后表结构停留在旧版本。
3. **健康检查不校验 Schema**：User/Agent 服务的 `/health` 只报进程存活，不校验数据库表是否齐备。
   MySQL 进程一健康，业务服务就启动并连库，缺表时运行到页面请求才降级为"服务暂时不可用"。

同时，本地栈曾从独立的旧 worktree 启动，而当前 master 已领先该提交——开发者误以为旧镜像
代表当前代码，浪费排查时间。镜像没有暴露构建所用的源码提交。

## 决策

### 1. 自研轻量迁移器（不引入 Flyway/Liquibase）

新增 `SchemaMigrationService`（约 250 行 Java）+ `schema_migrations` 记账本表：
- 扫描 classpath `db/migrations/V<数字>__<slug>.sql`，按版本号顺序应用。
- 每个版本记录 version、slug、checksum、status（applied/failed）、applied_at。
- 失败即停（fail-closed）：任意版本失败抛 `MigrationException`，进程 exit 非 0。

**理由**：项目用 MyBatis-Plus + dynamic-datasource，引入 Flyway 需验证兼容性且 v9+ 对部分
MySQL 特性需企业授权；自研迁移器零新依赖，完全可控，能精确实现"校验身份 + 执行结果 + 顺序"
语义，逻辑标准不复杂。

### 2. 现有 schema.sql 锚为 V1 基线

`db/schema.sql`（幂等化：`CREATE TABLE IF NOT EXISTS`，删除所有 `DROP TABLE`）作为 V1 基线
复制到 `db/migrations/V1__baseline.sql`。历史 `ik*.sql` 的变更已并入 schema.sql，不再由
迁移器执行（顶部加归档注释保留追溯）。

**旧库补记 V1**：迁移器检测到记账本为空 + `project` 基线表存在 → 判定为"迁移器引入前的旧库"，
直接在记账本补记 V1（不重跑 CREATE），然后从 V2 起跑增量。既有数据零损失。

### 3. 独立 migration 容器 + Compose depends_on 门禁

Compose 新增 `blue-whale-schema-migration` 服务，复用 agent 镜像，用 `migration-only` profile
跑完迁移即 exit 0。User/Agent 的 `depends_on` 加 `blue-whale-schema-migration:
condition: service_completed_successfully`——迁移失败则业务服务根本不启动，fail-closed 门禁
纯由 Compose 拓扑表达，业务代码零侵入。

MySQL 不再挂载 init SQL 到 `docker-entrypoint-initdb.d`，初始化与升级统一由迁移器接管。

### 4. 构建身份暴露

Java 服务 Dockerfile 加 `ARG GIT_COMMIT` / `ARG BUILD_TIME`，通过 LABEL + ENV 注入。
`local-mvp.sh` / `run-mvp-acceptance.sh` 在构建前 `export GIT_COMMIT=$(git rev-parse --short HEAD)`。
Agent/Gateway 的 `/health` 返回 `build.commit` / `build.builtAt`，启动日志打一行构建身份。

## 后果

- **正向**：无论空库还是旧库，迁移都按版本顺序自动升级到当前 Schema；迁移未完成时业务服务
  不启动；镜像可溯源到源码提交。
- **负向**：后续 Schema 变更必须以 `db/migrations/V<n>__<slug>.sql` 增量形式提交，不能再直接
  编辑 schema.sql 期望重建（V1 基线已固定）。历史 `ik*.sql` 退出舞台。
- **后续工单**：模板旧字段（`create_time/update_time/deleted`）、`cursor` 保留字等表内容修复
  由 IK1W1J/K/L/M 以 V2+ 增量形式处理。

## 已知边界（后续工单跟进）

1. **user-service 的 `users` 表未纳入迁移器**：迁移器位于 agent-service jar 内，只管 agent 库
   的表。user-service 仍通过 `spring.sql.init.mode=always`（`application.yml`）每次启动自跑
   `schema.sql` 建 `users` 表，绕过 fail-closed 门禁。这是跨模块耦合限制——user-service 是独立
   Maven 模块，其 schema 不应耦合进 agent 的迁移文件。后续若要统一，需将 users 表纳入迁移器
   或让 user-service 也 depends_on migration 容器（单独工单跟进）。
2. **V1__baseline.sql 与 schema.sql 内容重复**：V1 是 schema.sql 的幂等化副本，二者需同步维护。
   schema.sql 保留作为人读参考；V1__baseline.sql 是迁移器加载的权威源。未来改表应改 V1 对应的
   新增量文件，而非回改 V1（V1 已锁定）。建议加 CI 守卫防止二者意外漂移。
3. **模板种子数据归 IK1W1K**：V2__seed.sql 仅含 Skill 面板种子。template_card 种子数据与字段
   统一由 IK1W1K 负责（IK1W1K Blocked by IK1W1E）。空库启动后 template_card 表结构就绪但无数据。
