-- IKJCOE：generation_jobs 任务特有列收敛到 generation_job_extras 扩展表。
--
-- 背景：generation_jobs 已 42 列，且每来一单就往主表加列（IKIZQ8 一次加了 7 列）。
-- 代价是实打实的：读路径 job-repo.ts 是 findMany **无 select**，每加一列列表页都多传
-- 一次；表里绝大多数列对绝大多数 type 恒 NULL（稀疏并集）；每加一列要同步
-- schema.prisma + 三轨 SQL + parity 测试 + Java Entity + 可能还要改 Mapper SQL。
--
-- 本迁移做三件事，顺序不可换：
--   ① 建扩展表  ② 把要搬的列**回填**进扩展表  ③ 再删主表上那些列。
-- DDL 在 MySQL 非事务，中途失败会停在半途；回填必须早于 DROP，否则数据直接丢。
--
-- ── 为什么是 (job_id, extra_key, value_type, value_text) ────────────────────────
--   · 键值形态：任务类型各异（image/video/audio/抠图/混音/…），每种只用到少数几个
--     扩展位。按列加会长成稀疏并集，按行存则「多一种类型」是加数据不是加列。
--   · extra_key **沿用被迁移列的原字段名**（video_stage / charge_state / …）：读方
--     不用维护一层新旧名字的映射，回填语句与代码里的键名逐字对得上。
--   · 列名 extra_key 不叫 key：KEY 是 MySQL 保留字，手写 SQL 全要反引号，漏一个就是
--     1064。少一个踩坑面。
--   · value_type ∈ string/number/boolean/json，value_text 存十进制/字面量文本。
--     上限：超过 2^53 的数值必须用 string（epoch 毫秒 1.7e12 安全，无精度损失）。
--
-- ── 刻意不建的东西 ──────────────────────────────────────────────────────────────
--   · 不建 generation_job_id 单列索引：唯一索引 uk_generation_job_extras__job_key
--     的最左前缀已覆盖「按 job 取全部扩展位」，再建一条是纯浪费。
--   · 不建 is_delete / version：这是追加型子表，跟随 generation_job_logs /
--     generation_output_slots 的既有惯例。
--   · 不建外键/关系字段：全仓 schema.prisma 有 0 个 @relation，子表一律
--     「父表先查 + 子表二次查询 + 内存聚合」。
--
-- ── 回填口径（缺键 = 缺省语义，不为默认值造行）─────────────────────────────────
--   · video_stage / charge_state / final_job_id / upstream_created_at_ms /
--     finalize_deadline_ms / actual_credits：NULL 本身有语义（旧任务/普通视频/
--     未结算），只回填非 NULL 行。
--   · canvas_card_state 的列默认值是 'pending'，而扩展表里「缺键」即 'pending'，
--     故只回填 <> 'pending' 的行，不给每一条历史任务都造一行。
--   · strategy_version 建行时必写（三值之一），非 NULL 即回填。
--
-- 回填为什么用 INSERT IGNORE：DDL 在 MySQL 非事务，若本文件在**回填段中途**失败，
-- 重跑那几条已成功的语句会撞唯一索引；IGNORE 让它们成为空操作（此时源列还在，
-- 语句本身仍可执行）。代价是它也吞掉其他错误——所以回填语句保持最简形态
-- （SELECT + CAST），没有依赖上下文的表达式。
--
-- ⚠️ 走到下面 DROP COLUMN 之后，本文件就**不再可重跑**（CREATE TABLE 报 1050、源列
--    已被删）。这不是缺陷，是「删列」这一步的固有性质：半途失败只能人工接手，
--    按 last-error 定位后从断点继续。生产执行前务必先在影子库整份跑通。
SET NAMES utf8mb4;

CREATE TABLE `generation_job_extras` (
    `id`                BIGINT      NOT NULL AUTO_INCREMENT,
    `generation_job_id` BIGINT      NOT NULL,
    -- 扩展位键名：沿用被迁移列的原字段名（video_stage / charge_state / …）
    `extra_key`         VARCHAR(64) NOT NULL,
    -- string | number | boolean | json —— 决定 value_text 怎么读回来
    `value_type`        VARCHAR(16) NOT NULL,
    -- 值本体。number 用十进制字符串（JS Number() / Java Long.parseLong 对称）
    `value_text`        TEXT        NOT NULL,
    `gmt_create`        DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`      DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    -- 一个任务的一个扩展位只有一行；upsert 靠它判重，不靠应用层
    UNIQUE INDEX `uk_generation_job_extras__job_key`(`generation_job_id`, `extra_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ② 回填：搬进扩展表的 8 列（非 NULL 才回填，缺键即缺省）
INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'strategy_version', 'string', `strategy_version`
  FROM `generation_jobs` WHERE `strategy_version` IS NOT NULL;

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'canvas_card_state', 'string', `canvas_card_state`
  FROM `generation_jobs` WHERE `canvas_card_state` <> 'pending';

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'video_stage', 'string', `video_stage`
  FROM `generation_jobs` WHERE `video_stage` IS NOT NULL;

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'final_job_id', 'number', CAST(`final_job_id` AS CHAR)
  FROM `generation_jobs` WHERE `final_job_id` IS NOT NULL;

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'upstream_created_at_ms', 'number', CAST(`upstream_created_at_ms` AS CHAR)
  FROM `generation_jobs` WHERE `upstream_created_at_ms` IS NOT NULL;

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'finalize_deadline_ms', 'number', CAST(`finalize_deadline_ms` AS CHAR)
  FROM `generation_jobs` WHERE `finalize_deadline_ms` IS NOT NULL;

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'charge_state', 'string', `charge_state`
  FROM `generation_jobs` WHERE `charge_state` IS NOT NULL;

INSERT IGNORE INTO `generation_job_extras` (`generation_job_id`, `extra_key`, `value_type`, `value_text`)
  SELECT `id`, 'actual_credits', 'number', CAST(`actual_credits` AS CHAR)
  FROM `generation_jobs` WHERE `actual_credits` IS NOT NULL;

-- ③ 删列：先删索引再删列（next_poll_at 只写不读，领取门是 next_action_at，
--    它存在的唯一理由是撑着 idx_status_next_poll 这条索引）
ALTER TABLE `generation_jobs`
  DROP INDEX `idx_status_next_poll`,
  DROP COLUMN `next_poll_at`,
  -- 零读零写（stage_id / evidence_reconcile_until 唯一命中是 Java 实体映射；
  -- agent_run_id 全仓无调用方传值——计划通道已退役）
  DROP COLUMN `stage_id`,
  DROP COLUMN `evidence_reconcile_until`,
  DROP COLUMN `agent_run_id`,
  -- 同值双份且零读：真实副本在 cost_reservations.action_identity /
  -- command_idempotency.idempotency_key
  DROP COLUMN `action_identity`,
  DROP COLUMN `project_action_identity`,
  -- 恒为 1；权威在 generation_output_slots 的行数
  DROP COLUMN `expected_output_count`,
  -- 已搬进 generation_job_extras（值见上方回填段）
  DROP COLUMN `strategy_version`,
  DROP COLUMN `canvas_card_state`,
  DROP COLUMN `video_stage`,
  DROP COLUMN `final_job_id`,
  DROP COLUMN `upstream_created_at_ms`,
  DROP COLUMN `finalize_deadline_ms`,
  DROP COLUMN `charge_state`,
  DROP COLUMN `actual_credits`;
