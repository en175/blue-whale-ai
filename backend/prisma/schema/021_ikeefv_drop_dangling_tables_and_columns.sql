-- IKEEFV：删除 IKCKOW/IKD806 收尾遗留的 3 张零行悬空表 + agent_runs 3 个全空死列。
-- 与 prisma/migrations/20260909150000_ikeefv_drop_dangling_tables_and_columns/migration.sql 双轨同步。
-- 保留 agent_runs 表本体与其余带历史值的引擎列（InUse 禁删保护 + run_pin scrub 依赖 status/run_pin；
-- 其余 15 个死列存量非空，按「只报告不删」保留）。
-- 全库零 FOREIGN KEY / 视图 / 触发器（已核实），DROP 无约束失败风险。
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `conversation_message_mentions`;
DROP TABLE IF EXISTS `skill_summarize_session`;
DROP TABLE IF EXISTS `creative_skill_activation`;

ALTER TABLE `agent_runs`
  DROP COLUMN `current_checkpoint_id`,
  DROP COLUMN `confirmed_input_request_id`,
  DROP COLUMN `skill_summarize`;
