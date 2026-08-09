# 核心基础设施选型与权威边界

- **状态**：Accepted
- **日期**：2026-08-09
- **决策者**：KimJohn（经 `grill-with-docs` 会话确认）
- **关联工单**：[IK7FI6 统一技术栈规则与 Python 存量处置决策](https://gitee.com/hangzhou-xuanfu_1/blue-whale-ai/issues/IK7FI6)
- **关联决策**：[ADR-0061 Prisma 持久化与迁移策略](0061-prisma-persistence-and-migration-policy.md)、[ADR-0068 产品主技术栈与专用计算边界](0068-node-typescript-product-runtime-and-specialized-compute-boundary.md)

Blue-Whale 保留以下核心基础设施组合：MySQL 8.4 + Prisma 作为产品事实的关系型持久化与默认数据访问层；Redis + BullMQ 只承担快速唤醒、延迟调度和分发提示，任务权威、租约、fence 与幂等恢复仍在 MySQL；火山 TOS 保存私有媒体对象，数据库只保存稳定对象键与元数据，经过产品鉴权后签发短期访问 URL；代码库继续使用 pnpm workspace、`workspace:*` 与 TypeScript Project References 组织和构建 Node.js 模块。

Prisma 不形成禁止原生 SQL 的抽象边界。复杂锁、批处理或已证明的性能热点可以使用经过审查的原生 SQL，但数据库迁移历史仍须遵循 ADR-0061 的单一权威链路。对象存储供应商也不成为 Asset 身份：`asset_id` 与产品归属由数据库管理，TOS 只保存不可公开的对象字节。

## 当前实现偏差

- 数据库初始化仍同时存在 baseline SQL、Prisma Schema 与增量 migrations，且 `mysql2` 尚未按 ADR-0061 退役；应另行收敛为可从空库重放的单一 migration 历史。
- 仓库存在 BullMQ 版与纯数据库巡检版两个 Generation Worker 可执行入口；应另行确认唯一部署入口，不能让两者形成重复执行面。
- 当前 TOS 实现仍包含 `public-read` 与持久公网 URL；必须改为私有桶、稳定 `storage_key` 与鉴权后短期签名 URL。

上述偏差是后续修复事项，不改变本 ADR 的选型，也不在本次文档决策票中直接改写实现。

## 被否方案

- **无明确需求即迁移 PostgreSQL**：当前没有 PostgreSQL 独占能力需求，迁移会改写既有 Schema 原生类型、迁移 SQL、初始化和运维链路。
- **所有数据库访问强制只用 Prisma**：会让复杂锁与性能热点迁就 ORM；允许窄范围原生 SQL 更符合持久化边界。
- **让 BullMQ 成为 GenerationJob 权威**：队列可能重复交付或丢失运行状态，不能替代数据库中的产品事实与恢复证据。
- **现在更换 TOS 供应商**：当前问题是公开访问模型错误，不是供应商能力不足；更换供应商不会自动修复安全边界。
- **现在引入 Nx / Turborepo 或拆分多仓**：当前工程规模与构建耗时尚未证明增加编排层或仓库边界的收益。
