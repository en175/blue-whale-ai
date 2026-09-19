-- Agent 文本模型展示名修正（worktree chore-734aae45，无工单号，2026-09-19）。
--
-- 背景：画布 Agent 面板的模型下拉直接渲染 generation_model_capability.model_label
-- （web AgentPanel 取 GET /api/generation/models?capability=text，逐项渲染 model_label）。
-- 目录里 doubao-seed-evolving 这行的 model_label 与 model_id 同为英文标识
-- 「doubao-seed-evolving」，产品要求展示名读作「Seed-Evolving」，与 MiniMax-M3 等
-- 同目录其他行的可读名口径一致。
--
-- 只改 model_label，不动 model_id：后者是真正提交给供应方的模型名，CONTEXT.md 明文
-- 「创建后不可改」，改它会让请求打到不存在的模型上。展示名不参与请求构造。
--
-- 不写死主键 id：该行由管理后台添加，各环境 id 不一致，有的环境可能根本没有这行。
-- 按 (model_id, is_delete) 定位，目录里没这行时影响 0 行；重复执行幂等，第二次
-- changedRows 为 0。
--
-- 执行情况：测试站（14.103.43.52 blue_whale）已于 2026-09-19 执行，id=29。
-- 其他环境上线时照本文件执行。
--
-- 单轨说明：本文件只落 docs/sql，不进 backend/prisma/schema/ 与
-- backend/prisma/migrations/。理由是这次不是 schema 结构变更，且该模型行不在
-- seed 基线内、由运营在后台维护，写进迁移链只会得到一条「哪个环境恰好有这行才生效」
-- 的语句，不构成对所有环境成立的契约。先例 48ae4438 走双轨是因为它同时改了目录
-- 排序契约并有 parity 测试。

SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `model_label` = 'Seed-Evolving'
WHERE `model_id` = 'doubao-seed-evolving' AND `is_delete` = 0;
