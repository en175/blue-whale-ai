-- IK3GIM（docs/specs/2026-07-23-assistant-message-stream-attempt-contract.md）：
-- 一个 stream_id = 一次 AssistantMessageStreamAttempt；同一 AgentRun 最多 2 个顺序尝试、
-- 同时最多 1 个活动尝试。拆除每 Run 一条流的唯一键（uk_assistant_stream_run），改普通索引；
-- 活动约束与额度上限由服务层在 Run 行锁内校验。
-- 新增 abort 幂等键与规范化原因码列，支撑幂等 abort 与租约接管/supersede 兜底。
-- 纯 DDL 无数据迁移；H2 测试 schema 同步镜像本变更（schema-h2.sql）。

ALTER TABLE assistant_message_streams DROP INDEX uk_assistant_stream_run;
ALTER TABLE assistant_message_streams ADD INDEX idx_assistant_stream_run (agent_run_id);
ALTER TABLE assistant_message_streams ADD COLUMN abort_idempotency_key VARCHAR(128) NULL;
ALTER TABLE assistant_message_streams ADD COLUMN abort_reason_code VARCHAR(64) NULL;
