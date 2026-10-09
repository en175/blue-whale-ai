SET NAMES utf8mb4;

DROP TABLE IF EXISTS `conversation_message_mentions`;
DROP TABLE IF EXISTS `skill_summarize_session`;
DROP TABLE IF EXISTS `creative_skill_activation`;

ALTER TABLE `agent_runs`
  DROP COLUMN `current_checkpoint_id`,
  DROP COLUMN `confirmed_input_request_id`,
  DROP COLUMN `skill_summarize`;
