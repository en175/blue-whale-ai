-- IK67H3 (T08)：AgentAdvance 冻结本轮 MentionInputSnapshot。
-- 每次 advance 创建时同事务冻结显式引用的当前可用性与受限投影；接管复用，后续消息/Canvas 不改写。
-- 旧 advance 无该列语义 → NULL 兼容（历史 advance 不参与 mention 授权链）。
ALTER TABLE `agent_advances` ADD COLUMN `mention_input_snapshot` JSON NULL;
