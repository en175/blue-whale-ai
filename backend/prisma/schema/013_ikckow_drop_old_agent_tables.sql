-- IKCKOW：删除已停用旧内嵌 Agent 引擎的 6 张运行表。
-- 与 prisma/migrations/<ts>_ikckow_drop_old_agent_tables/migration.sql 双轨同步。
-- 保留 agent_runs（个人技能删除 InUse 禁删保护 + run_pin scrub）与
-- creative_skill_activation（技能库 usage_count）。
-- 6 表全库零 FOREIGN KEY / REFERENCES（已核实），DROP 无约束失败风险。
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `user_input_requests`;
DROP TABLE IF EXISTS `agent_provider_calls`;
DROP TABLE IF EXISTS `agent_provisional_chunks`;
DROP TABLE IF EXISTS `agent_provisional_deliveries`;
DROP TABLE IF EXISTS `run_commits`;
DROP TABLE IF EXISTS `agent_advances`;
