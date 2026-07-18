-- ⚠️ 已归档（IK1W1E）：本迁移的变更已并入 V1 基线 (db/migrations/V1__baseline.sql)。
-- 历史保留供追溯，不再由迁移器执行。新增量请放在 db/migrations/V<n>__<slug>.sql。
-- IK10I9 一次性生产迁移：允许无新生成动作的最终 Run 提交。
-- 示例：mysql --host=<host> --user=<user> --password <database> < ik10i9-pydantic-orchestrator-migration.sql
-- ALTER 语句由迁移台账保证只执行一次。

ALTER TABLE run_commits
    MODIFY COLUMN generation_job_id BIGINT NULL;
