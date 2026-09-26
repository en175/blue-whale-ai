-- 自建用户体系第一刀：会员等级（identity_memberships）。
--
-- 为什么先做这一张：`tier` 是整个计费体系里唯一一个**没有权威来源**的输入。
-- billing 的 Hold 请求带 tier（会员折扣、限等级活动都要它），但那份 tier 目前
-- 由调用方断言——传错档位就能拿到不该有的折扣。本表是它应该来的地方。
--
-- 为什么是一行一个**会员周期**（而不是一行一个用户的当前状态）：
--   * 订阅是周期性的，续费就是新周期；「用户现在是什么等级」是这些周期的一个**推导**，
--     不是独立事实。存成当前状态就得在续费/到期时改写历史，而历史要留着对账。
--   * 设计里的会员周期赠送幂等键 `grant:sub:{subId}:{period}` 需要一个稳定的「周期」实体，
--     没有周期行就无从表达「这个周期的赠送到没到过账」。
--
-- 为什么 tier 允许 free：降级不是「删掉会员行」。用户从 pro 掉回 free 是一次**状态变更**，
-- 用户会问「我的会员什么时候没的」，删行就答不上来。写一行 free 周期，时间线是完整的。
--
-- ⚠️ expires_at 允许为 NULL（永久）。但**不建议**把付费会员配成永久：
--    永久会员在续费/退款/对账上都没有「下一个月」这个抓手。
SET NAMES utf8mb4;
CREATE TABLE `identity_memberships` (
    `id`           BIGINT       NOT NULL AUTO_INCREMENT,
    `user_id`      BIGINT       NOT NULL,
    -- free | basic | pro | max —— 与 billing 侧的会员折扣表按同一套字面值
    `tier`         VARCHAR(16)  NOT NULL,
    -- active | expired | cancelled —— active 且未到期才参与等级推导
    `status`       VARCHAR(16)  NOT NULL DEFAULT 'active',
    `started_at`   DATETIME(0)  NOT NULL,
    -- NULL = 永久。等级推导按最晚到期取，故 NULL 排在最前
    `expires_at`   DATETIME(0)  NULL,
    -- purchase | grant | migrate | compensation —— 决定对账口径
    `source`       VARCHAR(24)  NOT NULL,
    -- 来源业务 id（订单号 / 工单号），事后回答「这个会员是为什么给的」
    `biz_id`       VARCHAR(128) NOT NULL,
    -- 发放/开通幂等键。同一周期重复开通靠它拦，不靠应用层判重
    `grant_key`    VARCHAR(190) NOT NULL,
    `gmt_create`   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified` DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`      INTEGER      NOT NULL DEFAULT 0,
    `is_delete`    TINYINT      NOT NULL DEFAULT 0,

    -- 同一周期只能开通一次（幂等）
    UNIQUE INDEX `uk_identity_memberships__grant_key`(`grant_key`),
    -- 等级推导走这条：该用户还有效的会员周期
    INDEX `idx_identity_memberships__user_status_expiry`(`user_id`, `status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
