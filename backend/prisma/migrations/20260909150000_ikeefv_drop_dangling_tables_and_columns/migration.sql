-- IKEEFV：清理 IKCKOW/IKD806 收尾遗留——3 张零行悬空表 + agent_runs 3 个全空死列。
-- 与 schema/021_ikeefv_drop_dangling_tables_and_columns.sql 双轨同步。
-- 证据（工单正文）：conversation_message_mentions 唯一写入点已随 IKCKOW 删除（仅剩 3 处只读，同步改容错）；
-- skill_summarize_session repo 全仓零消费者；creative_skill_activation 写入方 recordActivation 零调用
-- （读方 mapUsageCounts 按「缺表容错记 0」设计，usage_count 现值恒 0，删表行为等价）。
-- agent_runs 瘦身尺度 = 仅存量实测（39 行）全 NULL/默认值的 3 列：current_checkpoint_id、
-- confirmed_input_request_id、skill_summarize；其余 15 个引擎死列带历史值，只报告不删。
-- 全库零 FOREIGN KEY / 视图 / 触发器（已核实），DROP 无约束失败风险。
SET NAMES utf8mb4;

DROP TABLE IF EXISTS `conversation_message_mentions`;
DROP TABLE IF EXISTS `skill_summarize_session`;
DROP TABLE IF EXISTS `creative_skill_activation`;

ALTER TABLE `agent_runs`
  DROP COLUMN `current_checkpoint_id`,
  DROP COLUMN `confirmed_input_request_id`,
  DROP COLUMN `skill_summarize`;
