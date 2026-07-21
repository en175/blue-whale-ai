-- IK2QBX 规范化拒绝结果回喂 Agent
-- 治理拒绝不再以 GovernanceException 终结提交，改为把面向 User 的稳定公开码与安全提示
-- 落入 run_commits，经已接纳结果通道回喂 Worker，再以 DeferredToolResults 回喂模型
-- 拒绝不建 GenerationJob 也不扣成本预留，Run 设回 queued 让 Worker 下一轮认领并调整

ALTER TABLE run_commits ADD COLUMN rejected_action_id VARCHAR(128) NULL;
ALTER TABLE run_commits ADD COLUMN rejected_public_code VARCHAR(64) NULL;
ALTER TABLE run_commits ADD COLUMN rejected_message VARCHAR(512) NULL;
ALTER TABLE run_commits ADD COLUMN rejected_retryable TINYINT NOT NULL DEFAULT 0;
