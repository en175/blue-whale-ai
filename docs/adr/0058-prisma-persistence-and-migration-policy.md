# ADR-0058：Prisma 持久化与迁移策略

- **状态**：Accepted
- **日期**：2026-07-27
- **决策者**：朱建业（trueBurger）
- **关联工单**：[IK4AJJ](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK4AJJ)
- **上游决策**：[ADR-0055](0055-prelaunch-typescript-unification-scope.md)、[ADR-0057](0057-node-user-identity-and-credits-ledger.md)

## 背景

切片 0（IK4AK6）的持久化层 `packages/persistence` 用 `mysql2` 裸驱动 + 裸 SQL 文件（`schema/001_baseline.sql` + `002_seed.sql`），由 `scripts/init-typescript-baseline-db.sh` 经 `deploy/typescript-baseline/docker-compose.acceptance.yml` 起 fresh MySQL 后灌入。

本次改为 Prisma，并遵守用户当面定的改表铁律：**首次 `db push` 之后只准 migration，迭代中绝对禁 `db push`**。

## 决策

1. **`packages/persistence` 改用 Prisma**：`@prisma/client`（runtime）+ `prisma`（devDep）。`schema.prisma` 基于 baseline 11 表 + `users` + `user_credits`（ADR-0057）。
2. **迁移铁律**（落地顺序）：
   1. 先一起敲定 `schema.prisma`（表结构过审）；
   2. **首次** `prisma db push` 把 schema 一次性建到新库；
   3. 立即 `prisma migrate resolve --applied <baseline-migration>` 把已 push 的状态认作 baseline，补上 migration 历史；
   4. **之后所有改表** 只准 `prisma migrate dev --name <xxx>`，**迭代中绝对禁 `db push`**。
3. **`pnpm db:fresh`** = 起 docker MySQL（沿用 `deploy/typescript-baseline/docker-compose.acceptance.yml`）→ `prisma migrate deploy` → 灌 seed。
4. **移除 `mysql2`**。readiness 探针改 `prisma.$queryRaw\`SELECT 1\``。三入口（Next.js + `agent-worker` + `generation-worker`）的 readiness 一并切到 Prisma（product-api 已并入 Next.js，见 ADR-0056）。

## 连锁影响

- `packages/persistence` 重写：`src/mysql.ts` → Prisma client 单例 + readiness；新增 `prisma/schema.prisma` + `migrations/`。
- `apps/agent-worker`、`apps/generation-worker` 的 readiness 引用更新。
- `scripts/init-typescript-baseline-db.sh` 与根 `package.json` 的 `db:fresh` 脚本改走 Prisma。
- `001_baseline.sql` / `002_seed.sql` 在 Prisma baseline 建立后归档或删除（不双轨）。

## 被否方案

- **从第一次就用 `prisma migrate dev --name init`，永不 `db push`**（技术更干净、无 history 空档）。拒绝理由：用户明确希望首次保留 `db push` 的灵活度以便敲定表结构；本 ADR 用 `migrate resolve --applied` 弥补 `db push` 留下的 history 空档，既尊重用户工作流又保留可审查迁移史。
- **保留 `mysql2` 裸 SQL**。拒绝理由：用户要求换 Prisma；裸 SQL 在多表/多 slice 演进时缺乏类型安全与迁移治理。

## 修正（2026-10-10，IKKNMZ）：SQL 变更只走「手写 + 人工审批」，Prisma 迁移路已断

**决定**：本仓的 SQL 变更口径是**手写 SQL、人工审批后手工执行**，**不使用 Prisma 的迁移执行**。上文「决策 2 迁移铁律」的第 4 条与「决策 3 `pnpm db:fresh`」按本节作废。

**为什么**：上文写于 2026-07-27，早于 `backend/` 这套结构；三处描述与当前实际相反：

| 上文写的 | 实际（2026-10-10 实测） |
| --- | --- |
| 改表只准 `prisma migrate dev --name <xxx>` | **手写**编号 SQL（owner 确认） |
| `pnpm db:fresh` = `migrate deploy` + 灌 seed | 根 `package.json` 里**没有这个入口** |
| 迭代中**绝对禁** `db push` | `db push` 是 DB 门控集成测试的**常规建库配方**（适用范围见下） |

全仓调用 `prisma migrate deploy` / `migrate dev` 的地方**为零处**（唯一命中是 parity 测试里的字符串断言与迁移文件里的注释）。

**真陷阱（改前的实测输出）**：

```text
$ prisma migrate status
78 migrations found in prisma/migrations
Following migrations have not yet been applied:
20261008120000_scrub_frozen_provider_credential
20261009180000_ikkh81_drop_asset_material_group
To apply migrations in production run prisma migrate deploy.
```

`_prisma_migrations` 与实际的手工执行进度不一致，所以 Prisma **主动叫人去跑 `migrate deploy`** —— 一跑就把存量当没跑过**重放**。

**处置**：`prisma.config.ts` 的 `migrations.path` 指向 `prisma/disabled-prisma-migrations`，且该路径上放了一个**普通文件**。两份机制分别拦 `deploy` 与 `dev`（`migrations.path` 拦前者；后者对缺失目录会自己建，靠普通文件的 `ENOTDIR` 拦）—— 细节与实测输出见 `backend/prisma/README.md`。改后：

```text
$ prisma migrate deploy
No migration found in prisma/migrations
No pending migrations to apply.
```

**为什么用「指走路径」而不是删 `migration_lock.toml`**：后者 Prisma 会自动重建，删了只是「下次又长出来」；指走路径是**每次命令都拦**。

**三轨保留不变**：`prisma/migrations/`（78）/ `prisma/schema/`（71）/ `docs/sql/`（56），文本逐字一致，由各自的 `*-parity.test.ts` 守。目录名沿用 Prisma 命名，**但内容手写、无自动执行器**；`migrations/` 那一轨**不删** —— 它是三轨里的一轨，也是几十个 parity 测试的比对基准。

**`db push` 的适用范围**：**仅限一次性测试库**（DB 门控集成测试的建库配方）。**不得对测试站 / 生产库使用** —— 对上文的「绝对禁」按此收窄，而不是全禁。

**给下次读到上文的人的提示**：上文「决策 2 第 4 条」与「决策 3」已作废，照它办事**会去跑 `migrate deploy`**。现状以本节与 `backend/prisma/README.md` 为准。
