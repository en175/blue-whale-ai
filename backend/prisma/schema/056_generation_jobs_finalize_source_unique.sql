-- IKIZQC：成片来源唯一约束（契约 FINALIZE_SOURCE_UNIQUE_KEY，IKIZQ5 冻结）。
--
-- 语义：同一来源样片任务（source_sample_job_id）至多一条成片任务行——同键重放由
-- command_idempotency 消化，双击与两页并发（不同 Idempotency-Key）由本约束在数据库层
-- 原子裁决：输家整体回滚（预扣补偿同事务兜住），后到请求收 1057 finalize_already_attempted。
--
-- ── 为什么是裸唯一索引而不是 (source_sample_job_id, is_delete) 复合 ──────────────
-- 成片任务行**永不删除**：金标 G08 明确「已发往上游的失败尝试保留占位」，唯一约束必须
-- 连失败终态行一起占住来源——软删条件进索引会让「删了再建」绕过「一张样片首版至多一次
-- 已发往上游的成片尝试」。MySQL 唯一索引对 NULL 不去重，普通视频/样片行（source 为
-- NULL）不受影响。
SET NAMES utf8mb4;

ALTER TABLE `generation_jobs`
  ADD UNIQUE KEY `uk_generation_jobs__source_sample_job_id` (`source_sample_job_id`);
