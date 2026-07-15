-- IK10IB 一次性生产迁移：允许公开命令幂等记录关联 BottomDock GenerationJob。
ALTER TABLE command_idempotency
    MODIFY COLUMN message_id BIGINT NULL,
    MODIFY COLUMN agent_run_id BIGINT NULL,
    ADD COLUMN generation_job_id BIGINT NULL AFTER agent_run_id,
    ADD INDEX idx_command_generation_job (generation_job_id);
