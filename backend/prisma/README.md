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

- **禁 `prisma migrate dev` / `prisma migrate deploy`**。`_prisma_migrations` 表要么不存在、要么与手工执行的真实进度不一致 —— 这两条命令会把存量迁移当成**没跑过**，从第一条**重放**。
- 为防误跑，`prisma.config.ts` 的 `migrations.path` 已指向 `prisma/disabled-prisma-migrations`（不存在），所以这两条命令在这里会报「找不到迁移目录」而不是动手。

## 正常可用

- `prisma generate`（构建的一部分）
- `prisma db push` —— **仅限一次性测试库**（DB 门控集成测试的建库配方）。**不得对测试站 / 生产库使用**。
