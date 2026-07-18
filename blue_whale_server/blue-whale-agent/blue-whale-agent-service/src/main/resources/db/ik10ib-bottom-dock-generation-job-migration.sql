-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
-- IK10IB 一次性生产迁移：允许公开命令幂等记录关联 BottomDock GenerationJob。
ALTER TABLE command_idempotency
    MODIFY COLUMN message_id BIGINT NULL,
    MODIFY COLUMN agent_run_id BIGINT NULL,
    ADD COLUMN generation_job_id BIGINT NULL AFTER agent_run_id,
    ADD INDEX idx_command_generation_job (generation_job_id);
