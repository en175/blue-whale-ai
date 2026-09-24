-- 影子计价记录（迁移与切换 runbook §3.2）
--
-- ── 为什么需要这张表 ──────────────────────────────────────────────────────────
-- 切换期的硬约束是「billing 上线必须与 sk- 断链同时发生，不能有中间态」——
-- 否则我们扣一次、new-api 再扣一次，用户被扣两遍。
--
-- 于是切换前有一段**影子期**（runbook 要求至少一周）：worker 已经把用量报给我们，
-- 我们用它算一遍价，**但只记不扣**；同时 new-api 那边仍在扣用户的 quota。
-- 两边每日比对，差异 > 1% 就停下修定价。
--
-- 影子期是唯一一个「不扣两次也能知道算得对不对」的办法。
-- 表里记的是**我们算出来的数**，以及上游报的成本——另一半（new-api 扣了用户多少）
-- 由对账任务读上游日志后回填。
--
-- ── 为什么与账本分开，而不是往账本里塞一行 ────────────────────────────────────
-- 账本是**钱的权威记录**，append-only 且参与试算平衡。影子期的数字一分钱都没动过，
-- 混进去会让「wallet + frozen == Σ remaining」这条恒等式当场破，
-- 也会让对账分不清「真的扣了」与「只是算过」。
SET NAMES utf8mb4;
CREATE TABLE `billing_shadow_entries` (
    `id`                    BIGINT       NOT NULL AUTO_INCREMENT,
    -- 一个 job 一行；MQ 至少一次投递，靠它拦重复
    `generation_job_id`     BIGINT       NOT NULL,
    `user_id`               BIGINT       NOT NULL,

    -- priced | unpriceable
    -- ⚠️ unpriceable 是**成功记录的一种**，不是错误日志：影子期跑出来的漏配清单
    --    就是切换前要修掉的东西，它必须和正常行一样能被统计与导出。
    `status`                VARCHAR(16)  NOT NULL,

    -- 我们算出来的价（整数积分）。unpriceable 时为 NULL。
    `computed_credits`      BIGINT       NULL,
    -- 算出这个数用的版本与折扣——差异排查时要按它复现
    `catalog_version`       INT          NULL,
    `discount_bp`           INT          NULL,

    -- 上游实际收**我们**的（mc，毛利分析原料），来自用量上报
    `upstream_cost_credits` BIGINT       NULL,
    -- 上游实际收**用户**的（new-api quota）。影子期由对账任务读上游日志回填；
    -- 这才是与被扣金额直接比对的那一列。
    `upstream_user_credits` BIGINT       NULL,

    -- 用量与规格快照：差异排查时第一个要问的是「拿什么算的」
    `usage_json`            JSON         NOT NULL,
    -- unpriceable 时的原因（未配规则 / 规格查不到价）
    `error_message`         VARCHAR(255) NOT NULL DEFAULT '',

    `gmt_create`            DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    -- 幂等：一个 job 只记一次
    UNIQUE INDEX `uk_billing_shadow_entries__job`(`generation_job_id`),
    -- 日比对按时间扫
    INDEX `idx_billing_shadow_entries__created`(`gmt_create`),
    -- 「这批 unpriceable 是哪些模型」——漏配清单要从这里出
    INDEX `idx_billing_shadow_entries__status`(`status`, `gmt_create`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 回填 new-api 侧数字的口径说明（对账任务用）：
--   上游日志里 quota 的语义见《迁移与切换 runbook》；回填后
--   `upstream_user_credits` 与本行 `computed_credits` 的差异即为该 job 的计价偏差。
--   差异 > 1% 触发停止切换、修定价（§3.2）。
