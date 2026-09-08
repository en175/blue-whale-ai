-- IK67H8 (T10)：PlanMessage 手动应用闭环（图片分支）。
-- plan_messages 记录首次成功应用时间 + 首个图片任务，支持 at-most-once 与刷新恢复；
-- plan_application_receipts（IK67H9 建表）补图片分支所需的会话/运行归属列（视频路径留空）。
-- 幂等走 command_idempotency（operation=plan_message.apply）+ uk_plan_application_receipt_message 兜底并发第二写。
ALTER TABLE `plan_messages` ADD COLUMN `applied_at` DATETIME(0) NULL;
ALTER TABLE `plan_messages` ADD COLUMN `first_generation_job_id` BIGINT NULL;

ALTER TABLE `plan_application_receipts` ADD COLUMN `conversation_id` BIGINT NULL;
ALTER TABLE `plan_application_receipts` ADD COLUMN `agent_run_id` BIGINT NULL;
