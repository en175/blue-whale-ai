# IKCH05 生产同步：首页背景配置（homepage_hero）迁移文档

> ⚠️ **已作废（2026-10-10，IKKNMZ）**：本文推荐的 `prisma migrate deploy` / `prisma migrate resolve` 已**禁用**（原因与闸的机制见 `backend/prisma/README.md` 与 ADR-0058 修正节）。文中的 `packages/persistence/…` 路径也早已不存在。本单只做标注，未重写本文。

> 用途：IKCH01「首页背景图/视频支持后台动态配置」子任务 **IKCH05【后端】** 的数据库迁移。
> 测试库已应用（`prisma migrate deploy` 2026-09-01 成功，finished_at=2026-09-01 09:56:44）。
> **生产库同步时执行本文档。** 迁移已随 PR !514 合入 master，代码已部署；生产只缺这一张表。

## 迁移文件位置（仓库已落档，双轨同步）

| 文件 | 说明 |
|---|---|
| `packages/persistence/prisma/migrations/20260901142500_ikch05_homepage_hero/migration.sql` | Prisma 迁移权威源（`prisma migrate deploy` 使用） |
| `packages/persistence/schema/012_ikch05_homepage_hero.sql` | 手工 SQL 双轨副本 |
| `packages/persistence/schema/001_baseline.sql`（约 840 行起） | baseline 同步段 |

## 方式一（推荐）：Prisma migrate deploy

生产用与测试库相同方式，自动建表 + 自动登记 `_prisma_migrations`（含 checksum，最稳妥）：

```bash
CI=true DATABASE_URL="mysql://<user>:<pass>@<host>:<port>/blue_whale" \
  pnpm --dir packages/persistence exec prisma migrate deploy
```

只应用这一条：`Applying migration 20260901142500_ikch05_homepage_hero`。

## 方式二：手工直跑 SQL（生产不便跑 Prisma 时）

### 1. 建表 DDL（与 migration.sql 完全一致）

```sql
-- IKCH05：首页背景图/视频后台动态配置条目。
-- media_type=image|video；视频必须有 poster_url；enabled=1 进首页轮播，
-- 按 sort_order 升序；上限 8 条（应用层校验）。
CREATE TABLE `homepage_hero` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `media_type` VARCHAR(16) NOT NULL DEFAULT 'video',
    `media_url` VARCHAR(512) NOT NULL,
    `poster_url` VARCHAR(512) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `enabled` TINYINT NOT NULL DEFAULT 1,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    INDEX `idx_hero_enabled_sort`(`enabled`, `is_delete`, `sort_order`),
    INDEX `idx_hero_sort`(`sort_order`, `is_delete`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. 登记迁移历史（关键，别漏）

手工建表后必须让 Prisma 知道该迁移已应用，否则下次 `prisma migrate deploy` 会重跑建表报错。**不要手插 `_prisma_migrations` 行**（checksum 对不上会报迁移漂移），用官方登记命令：

```bash
CI=true DATABASE_URL="mysql://<user>:<pass>@<host>:<port>/blue_whale" \
  pnpm --dir packages/persistence exec prisma migrate resolve --applied 20260901142500_ikch05_homepage_hero
```

### 3. 回滚（如需）

```sql
DROP TABLE `homepage_hero`;
-- 回滚后同样要 resolve：prisma migrate resolve --rolled-back 20260901142500_ikch05_homepage_hero
```

## 验证（同步后必查）

```sql
-- 1. 表存在
SHOW TABLES LIKE 'homepage_hero';

-- 2. 迁移已登记（无 rolled_back_at）
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name LIKE '%ikch05%';

-- 3. 数据行（正常应为空）
SELECT COUNT(*) FROM homepage_hero;
```

线上探针验证（部署 + 迁移后）：
- `GET https://web.master.xfai.cloud/api/site/homepage-heroes` → `200 {"data":[]}`
- admin 列表带登录态 → `200 {"success":true,"data":[]}`

## 注意事项

- 表字符集 `utf8mb4 / utf8mb4_unicode_ci`，与库内其他表一致。
- `id` 为 BIGINT 自增；后端把 BigInt 序列化为 string 返回，前端按字符串处理。
- 软删除用 `is_delete=1`，`gmt_create/gmt_modified` 默认当前时间；应用层维护 `sort_order` 连续、`enabled=1` 上限 8 条。
