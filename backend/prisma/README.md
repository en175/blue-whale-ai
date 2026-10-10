# backend/prisma 的 SQL 口径

**这里的 SQL 是手写的，执行靠人工审批。不要用 Prisma 的迁移命令。**

## 三轨

同一份变更要落三处、文本逐字一致，由各自的 `*-parity.test.ts` 守住：

| 轨 | 位置 | 现有条数 |
| --- | --- | --- |
| 编号迁移 | `prisma/migrations/<时间戳>_<名>/migration.sql` | 78 |
| schema 快照 | `prisma/schema/<编号>_<名>.sql` | 71 |
| 历史记录 | `docs/sql/<日期>_<工单>_<名>.sql` | 56 |

目录名沿用 Prisma 的命名，**但内容是人写的，也没有任何自动执行器**。

## 禁止

- **禁 `prisma migrate dev` / `prisma migrate deploy`**。`_prisma_migrations` 表要么不存在、要么与手工执行的真实进度不一致 —— `deploy` 会把存量迁移当成**没跑过**、从第一条**重放**。

怎么拦的（两份保险，机制不同，别记混）：

| 命令 | 被谁拦 | 实测表现 |
| --- | --- | --- |
| `migrate deploy` / `migrate status` / `migrate resolve` | `prisma.config.ts` 的 `migrations.path` 指到了别处 | `No migration found in prisma/migrations` / `No pending migrations to apply.` |
| `migrate dev` | **不是**被 `migrations.path` 拦的 —— 它对缺失的迁移目录会**自己建**。拦住它的是「那个路径上放了一个**普通文件**」（本目录的 `disabled-prisma-migrations`），`mkdir` 直接 `ENOTDIR` 失败 | `Error: Failed to create a new migration directory: ENOTDIR`，**不执行任何我们的 DDL** |

`migrate dev` 的残留：它会在目标库建一张 `_prisma_migrations` 记账表（Prisma 自己的表，无业务 DDL）。

⚠️ `prisma migrate diff --from-migrations prisma/migrations …` 是**显式传路径**的，绕过本闸 —— 它只算不执行，但仍能读到那 78 个目录，别把它当「闸也拦得住」的证据。

## 正常可用

- `prisma generate`（构建的一部分）
- `prisma db push` —— **仅限一次性测试库**（DB 门控集成测试的建库配方）。**不得对测试站 / 生产库使用**。
