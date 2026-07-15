-- IK10I9 一次性生产迁移：允许无新生成动作的最终 Run 提交。
-- 示例：mysql --host=<host> --user=<user> --password <database> < ik10i9-pydantic-orchestrator-migration.sql
-- ALTER 语句由迁移台账保证只执行一次。

ALTER TABLE run_commits
    MODIFY COLUMN generation_job_id BIGINT NULL;
