-- IK9VZ0：多退少补结算审计表（蓝鲸端只记账，执行在 new-api）。
-- 幂等：batch_no 整批唯一；generation_job_id + action_type 单项唯一（NULL job 不受单项约束，靠整批幂等兜底）。
CREATE TABLE `cost_adjustments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `batch_no` VARCHAR(64) NOT NULL,
    `generation_job_id` BIGINT NULL,
    `user_id` BIGINT NOT NULL,
    `project_id` BIGINT NULL,
    `action_type` VARCHAR(32) NOT NULL,
    `amount_fen` BIGINT NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `new_api_snapshot` TEXT NULL,
    `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version` INTEGER NOT NULL DEFAULT 0,
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_adj_batch`(`batch_no`),
    UNIQUE INDEX `uk_adj_job_action`(`generation_job_id`, `action_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
