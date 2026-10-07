-- 工单：IKJNVR；当前修复根：IKJNVK；上级规格：IKIXK9。
-- 原实施工单：IKJJQU（IKIXK9-SPEC-20261002 B.2）。
-- 原迁移日期：2026-10-03；补录日期：2026-10-05。
-- 变更简述：补录生成任务恢复契约 v1 的历史 DDL，包含 command_idempotency.result_payload
-- 及 generation_canvas_submissions、generation_canvas_outputs、generation_canvas_node_owners 三张表。
-- 本文件仅用于历史追溯，不是新增迁移；本次补录不新增或修改数据库结构，不执行 SQL 或操作数据库。
-- 已执行原迁移的数据库不得重复执行本快照。
-- Prisma 迁移权威：backend/prisma/migrations/20261003000000_ikjjqu_canvas_recovery_v1/migration.sql。
-- 结构权威：backend/prisma/schema/060_ikjjqu_canvas_recovery_v1.sql 与 backend/prisma/schema.prisma。
-- 本快照不替代上述迁移与结构权威。字段位置、字符集、排序规则等 Prisma 模型无法表达的细节以权威 SQL 为准。

-- IKJJQU（IKIXK9-SPEC-20261002 B.2）：生成任务恢复契约 v1 的三张关系表 +
-- command_idempotency 的可空回执列。
--
-- 设计要点（为什么是这三张表）：
--   · generation_canvas_submissions —— 提交意图关联。受理回执丢失后靠它找回任务；
--     唯一约束 (project_id, submission_id) 承接同意图重放幂等，(project_id, target_node_id,
--     binding_revision) 钉住「同节点同承接版本的两次新意图只受理一个」。
--   · generation_canvas_outputs —— 逐输出记录。$target 项不建行（状态在 submissions 行上），
--     无行即 pending/revision=0；首次成功保存 apply/remove 才插行。(submission_id, node_id)
--     唯一约束表达「一个提交里每个结果卡只有一个输出项」，与 $target/primary 一对一转换共享
--     同一 node 的模型配套（$target 无行，primary 转换后才有行）。
--   · generation_canvas_node_owners —— 节点唯一归属。解决结果卡原位再生成时跨提交的唯一
--     承接问题；唯一约束 (project_id, node_id) 是同项目同节点唯一有效承接者的数据库闸。
--     删除保留归属行和版本，不能把身份重置成首次绑定。
--
-- 刻意不建的东西（对齐 generation_job_extras 迁移的惯例）：
--   · 不建外键/关系字段：全仓 schema.prisma 有 0 个 @relation，子表一律
--     「父表先查 + 子表二次查询 + 内存聚合」。
--   · 不建 is_delete / version：追加型子表，删除语义由 state 列表达（removed/transferred）。
--   · 不建 TTL 清理或后台调度：关联存续期间创建幂等记录不得失效后重新受理同意图（规格 B.1）。
--
-- command_idempotency.result_payload：可空 JSON，只保存新协议（SAVE_CANVAS_RECOVERY_V1）
-- 的紧凑成功回执，不保存完整画布历史；既有操作（generation.create / retry / finalize）
-- 不写该列，列语义零变化。回执和文档同事务写入（由保存事务保证，不在 DDL 层）。

SET NAMES utf8mb4;

-- ① command_idempotency 增列（可空，零回填）
ALTER TABLE `command_idempotency`
  ADD COLUMN `result_payload` JSON NULL AFTER `resource_id`;

-- ② 提交意图关联表
CREATE TABLE `generation_canvas_submissions` (
    `id`                       BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id`               BIGINT       NOT NULL,
    `user_id`                  BIGINT       NOT NULL,
    `protocol_version`         INT          NOT NULL,
    `submission_id`            VARCHAR(36)  NOT NULL,
    `operation`                VARCHAR(64)  NOT NULL,
    `request_hash`             VARCHAR(64)  NOT NULL,
    `generation_job_id`        BIGINT       NOT NULL,
    `task_type`                VARCHAR(32)  NOT NULL,
    `target_node_id`           VARCHAR(128) NOT NULL,
    `binding_revision`         INT          NOT NULL,
    `recovery_seed`            JSON         NULL,
    `previous_target_snapshot` JSON         NULL,
    `target_state`             VARCHAR(16)  NOT NULL,
    `target_revision`          INT          NOT NULL,
    `gmt_create`               DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`             DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_submissions__submission`(`project_id`, `submission_id`),
    UNIQUE INDEX `uk_generation_canvas_submissions__binding`(`project_id`, `target_node_id`, `binding_revision`),
    INDEX `idx_generation_canvas_submissions__project`(`project_id`, `id`),
    INDEX `idx_generation_canvas_submissions__job`(`generation_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ③ 逐输出记录表
CREATE TABLE `generation_canvas_outputs` (
    `id`                              BIGINT       NOT NULL AUTO_INCREMENT,
    `generation_canvas_submission_id` BIGINT       NOT NULL,
    `output_key`                      VARCHAR(128) NOT NULL,
    `node_id`                         VARCHAR(128) NOT NULL,
    `asset_id`                        BIGINT       NULL,
    `slot_id`                         BIGINT       NULL,
    `state`                           VARCHAR(16)  NOT NULL,
    `revision`                        INT          NOT NULL,
    `gmt_create`                      DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`                    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_outputs__key`(`generation_canvas_submission_id`, `output_key`),
    UNIQUE INDEX `uk_generation_canvas_outputs__node`(`generation_canvas_submission_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ④ 节点唯一归属表
CREATE TABLE `generation_canvas_node_owners` (
    `id`                              BIGINT       NOT NULL AUTO_INCREMENT,
    `project_id`                      BIGINT       NOT NULL,
    `node_id`                         VARCHAR(128) NOT NULL,
    `generation_canvas_submission_id` BIGINT       NOT NULL,
    `output_key`                      VARCHAR(128) NOT NULL,
    `binding_revision`                INT          NOT NULL,
    `gmt_create`                      DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`                    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_generation_canvas_node_owners__node`(`project_id`, `node_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
