# ADR-0061：Prisma 持久化与迁移策略

- **状态**：Accepted
- **日期**：2026-07-27
- **决策者**：朱建业（trueBurger）
- **关联工单**：[IK4AJJ](https://gitee.com/hangzhou_xuanfu_1/blue-whale-ai/issues/IK4AJJ)
- **上游决策**：[ADR-0055](0055-prelaunch-typescript-unification-scope.md)、[ADR-0060](0060-node-user-identity-and-credits-ledger.md)

## 背景

切片 0（IK4AK6）的持久化层 `packages/persistence` 用 `mysql2` 裸驱动 + 裸 SQL 文件（`schema/001_baseline.sql` + `002_seed.sql`），由 `scripts/init-typescript-baseline-db.sh` 经 `deploy/typescript-baseline/docker-compose.acceptance.yml` 起 fresh MySQL 后灌入。

本次改为 Prisma，并遵守用户当面定的改表铁律：**首次 `db push` 之后只准 migration，迭代中绝对禁 `db push`**。

## 决策

1. **`packages/persistence` 改用 Prisma**：`@prisma/client`（runtime）+ `prisma`（devDep）。`schema.prisma` 基于 baseline 11 表 + `users` + `user_credits`（ADR-0060）。
2. **迁移铁律**（落地顺序）：
   1. 先一起敲定 `schema.prisma`（表结构过审）；
   2. **首次** `prisma db push` 把 schema 一次性建到新库；
   3. 立即 `prisma migrate resolve --applied <baseline-migration>` 把已 push 的状态认作 baseline，补上 migration 历史；
   4. **之后所有改表** 只准 `prisma migrate dev --name <xxx>`，**迭代中绝对禁 `db push`**。
3. **`pnpm db:fresh`** = 起 docker MySQL（沿用 `deploy/typescript-baseline/docker-compose.acceptance.yml`）→ `prisma migrate deploy` → 灌 seed。
4. **移除 `mysql2`**。readiness 探针改 `prisma.$queryRaw\`SELECT 1\``。三入口（Next.js + `agent-worker` + `generation-worker`）的 readiness 一并切到 Prisma（product-api 已并入 Next.js，见 ADR-0059）。

## 连锁影响

- `packages/persistence` 重写：`src/mysql.ts` → Prisma client 单例 + readiness；新增 `prisma/schema.prisma` + `migrations/`。
- `apps/agent-worker`、`apps/generation-worker` 的 readiness 引用更新。
- `scripts/init-typescript-baseline-db.sh` 与根 `package.json` 的 `db:fresh` 脚本改走 Prisma。
- `001_baseline.sql` / `002_seed.sql` 在 Prisma baseline 建立后归档或删除（不双轨）。

## 被否方案

- **从第一次就用 `prisma migrate dev --name init`，永不 `db push`**（技术更干净、无 history 空档）。拒绝理由：用户明确希望首次保留 `db push` 的灵活度以便敲定表结构；本 ADR 用 `migrate resolve --applied` 弥补 `db push` 留下的 history 空档，既尊重用户工作流又保留可审查迁移史。
- **保留 `mysql2` 裸 SQL**。拒绝理由：用户要求换 Prisma；裸 SQL 在多表/多 slice 演进时缺乏类型安全与迁移治理。
