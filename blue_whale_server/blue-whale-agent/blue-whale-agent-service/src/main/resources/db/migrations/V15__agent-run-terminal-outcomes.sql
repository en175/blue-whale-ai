-- IK3BG2（ADR-0043）：AgentRun failed 终态持久化 Worker 规范化错误码族。
-- error_code 为 Worker 侧规范化码（BUNDLE_* / ORCHESTRATOR_CONTRACT_MISMATCH / ORCHESTRATION_FAILED），
-- error_message 维持 Worker 既有脱敏契约（不含快照正文或私有路径），Java 原样持久化、列长截断兜底。
-- 纯 DDL 无数据迁移；H2 测试 schema 同步镜像本列（schema-h2.sql）。

ALTER TABLE agent_runs ADD COLUMN error_code VARCHAR(96) NULL;
ALTER TABLE agent_runs ADD COLUMN error_message VARCHAR(1024) NULL;
