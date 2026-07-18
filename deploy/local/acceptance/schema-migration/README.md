# Schema 迁移与就绪门禁（IK1W1E）

本地完整 Compose 栈的版本化数据库迁移机制。架构决策见
[ADR-0037](../../../docs/adr/0037-schema-migration-framework.md)。

## 机制概览

```
MySQL(healthy) → blue-whale-schema-migration(跑迁移, exit 0) → user/agent 启动
                        ↓ 失败则 exit 非 0
                  user/agent 因 depends_on 不启动（fail-closed 门禁）
```

- **单一迁移入口**：`blue-whale-schema-migration` 容器复用 agent 镜像，用 `migration-only`
  profile 启动，扫描 `db/migrations/V<n>__<slug>.sql` 按版本号顺序应用。
- **记账本**：`schema_migrations` 表持久记录每个版本的应用状态（applied/failed）、checksum、时间。
- **旧库自动升级**：迁移器检测到记账本为空 + `project` 表存在 → 判定为旧库，补记 V1（不重跑
  CREATE），从 V2 起跑增量。既有数据零损失。
- **门禁**：User/Agent 的 `depends_on: blue-whale-schema-migration:
  condition: service_completed_successfully`。迁移失败则业务服务根本不启动。

## 迁移文件约定

新增 Schema 变更时，在
`blue_whale_server/blue-whale-agent/blue-whale-agent-service/src/main/resources/db/migrations/`
下创建 `V<下一个版本号>__<简短英文描述>.sql`，例如 `V4__<change>.sql`。

- 版本号连续递增（V1、V2、V3…），不可重复。
- SQL 必须幂等（`CREATE TABLE IF NOT EXISTS`、`INSERT IGNORE`、information_schema 守卫等），便于重复启动。
- V1 = 基线 Schema（等价于 `db/schema.sql`），V2 = 模板与 Skill seed 数据，
  V3 = 产品事件与 Outbox 游标物理列去保留字（`` `cursor` `` → `event_cursor`，IK1W1M）
  + GenerationJob/Asset 域旧库结构收敛（IK1W1L）：对受支持历史形态原地建缺表、补缺列、
  收敛旧约束并幂等回填输出槽；无法安全识别的漂移 fail-closed（查不存在表名携带漂移摘要报错）。

历史 `ik*.sql` 已归档（顶部有注释），变更已并入 V1，不再执行。

## 构建身份核对

镜像构建时注入源码 commit 与时间。启动后可通过以下方式核对正在运行的镜像来自哪个 checkout：

```bash
# 方式 1：启动日志（docker logs）
docker logs bw-agent 2>&1 | grep "Blue-Whale build"

# 方式 2：/health 端点
curl -s http://localhost:8082/health | python3 -m json.tool

# 方式 3：镜像 LABEL
docker inspect blue-whale-agent:local | grep blue-whale.git-commit
```

## 四场景验收

```bash
# 前置：先构建 :acceptance 镜像（run-mvp-acceptance.sh 会构建）
scripts/run-mvp-acceptance.sh --keep-stack   # 或 docker compose build

# 跑全部四个场景（各自独立 Compose 项目，结束清理）
scripts/run-schema-acceptance.sh

# 或只跑单个场景
scripts/run-schema-acceptance.sh empty               # 空库初始化
scripts/run-schema-acceptance.sh upgrade             # 旧库保数据升级
scripts/run-schema-acceptance.sh drift               # 未知漂移失败（fail-closed）
scripts/run-schema-acceptance.sh upgrade-generation  # 生成域旧库升级（IK1W1L）
```

### 场景说明

| 场景 | 夹具 | 期望 |
|------|------|------|
| empty | 无（空卷） | 迁移跑 V1+V2+V3，记账本记录 1,2,3，表齐全，游标物理列为 event_cursor |
| upgrade | `fixtures/old-baseline.sql` | 旧库补记 V1，既有 project 数据（id 9001/9002）保留；旧事件/Outbox 游标值、身份、状态与重试元数据完整保留 |
| drift | `fixtures/drift.sql` | 记账本谎称 V1 但缺 project 表 → V2 失败，业务服务不启动 |
| upgrade-generation | `fixtures/old-generation-schema.sql` | pre-ik10i6 形态 generation 域旧库：V3 建缺表、补缺列、收敛旧约束并回填输出槽；既有 Job 6001/Asset 7001/Canvas 8001 及其关联保留；重复迁移幂等 |

## 开发者日常

```bash
scripts/local-mvp.sh up      # 启动栈（migration 容器自动跑迁移）
scripts/local-mvp.sh health  # 含 migration 容器状态检查
scripts/local-mvp.sh init    # down -v 清库后 up（迁移器重新跑全部版本）
```

已有数据卷不会被清空——`up` 时迁移器检测到旧库会补记 V1 并跑增量，保留既有数据。
