-- IK10ID 一次性生产迁移：在发布多输出与缺失输出重试前执行。
ALTER TABLE generation_jobs
    ADD COLUMN expected_output_count INT NOT NULL DEFAULT 1 AFTER action_identity,
    ADD COLUMN retry_of_job_id BIGINT NULL AFTER expected_output_count,
    ADD INDEX idx_generation_job_retry_of (retry_of_job_id);

ALTER TABLE generation_job_outputs
    ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'pending' AFTER content_sha256,
    ADD COLUMN error JSON NULL AFTER status;

ALTER TABLE generation_provider_tasks
    DROP INDEX uk_provider_task_job,
    ADD COLUMN slot_index INT NOT NULL DEFAULT 0 AFTER generation_job_id,
    ADD UNIQUE INDEX uk_provider_task_job_slot (generation_job_id, slot_index);

INSERT INTO generation_job_outputs
    (generation_job_id, slot_index, asset_id, content_sha256, status, error)
SELECT job.id,
       0,
       asset.id,
       asset.content_sha256,
       CASE
           WHEN asset.id IS NOT NULL OR job.status = 'succeeded' THEN 'succeeded'
           WHEN job.status = 'failed' THEN 'failed'
           ELSE 'pending'
       END,
       CASE
           WHEN job.status = 'failed'
               THEN COALESCE(job.error,
                   JSON_OBJECT('code', 'legacy_failed', 'message', '生成失败'))
           ELSE NULL
       END
FROM generation_jobs job
LEFT JOIN generation_job_outputs existing
    ON existing.generation_job_id = job.id
    AND existing.slot_index = 0
    AND existing.is_delete = 0
LEFT JOIN (
    SELECT generation_job_id, MIN(id) AS asset_id
    FROM assets
    WHERE is_delete = 0
      AND generation_job_id IS NOT NULL
    GROUP BY generation_job_id
) first_asset ON first_asset.generation_job_id = job.id
LEFT JOIN assets asset ON asset.id = first_asset.asset_id
WHERE job.is_delete = 0
  AND existing.id IS NULL;

UPDATE generation_job_outputs
SET status = 'succeeded'
WHERE asset_id IS NOT NULL;

UPDATE generation_job_outputs output
JOIN generation_jobs job ON job.id = output.generation_job_id
SET output.status = 'failed',
    output.error = COALESCE(job.error, JSON_OBJECT('code', 'legacy_failed', 'message', '生成失败'))
WHERE output.asset_id IS NULL
  AND job.status = 'failed';
