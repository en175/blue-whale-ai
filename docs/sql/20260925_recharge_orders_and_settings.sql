-- 充值接回支付通道（blue-whale-pay 的杭州银行聚合主扫）：本地订单表 + 商户凭证表。
--
-- 为什么这两张表一起出：它们是一条链路的两半，缺一张这条链路就不成立。
--   * `recharge_orders` 回答「这笔钱该不该给这个用户发积分、发多少、发过没有」；
--   * `system_settings` 回答「拿哪个商户号去下单」。
-- 分开两次迁移只会让中间那个版本处于「有一半」的状态。
--
-- 为什么订单必须落在**我们自己的库**（而不是只在支付网关那边）：
--   1. 到账动作是给用户发积分，发多少必须在**下单时刻冻结**——换算率 `creditsPerYuan`
--      是定价目录里的配置项、可改；用户看到「1000 积分」并按它付了钱，之后运营改口径
--      不能反悔成 800。冻结值只能存在我们自己的行里。
--   2. 幂等：网关的回调会重投（最多 6 次），积分只能发一次。发一次的判据必须是
--      我们自己这条已落库的记录，不能靠「网关只推一次」这种假设。
--
-- ⚠️ `trade_no` 是我们**发给网关的商户订单号**（网关那边叫 `mchOrderNo`），不是网关的
--    `payOrderId`。两者都要存：对账按前者（我们自己生成的，先于调用存在），
--    回调按后者兜底（网关重投的报文里两个都有，但支付网关的商户查询接口以它索引）。
SET NAMES utf8mb4;

CREATE TABLE `recharge_orders` (
    `id`               BIGINT       NOT NULL AUTO_INCREMENT,
    -- 我们的商户订单号（发给支付网关的 mchOrderNo），唯一
    `trade_no`         VARCHAR(64)  NOT NULL,
    -- 支付网关的订单号（payOrderId）；下单应答回来才写，故可空。
    -- 唯一：同一笔网关订单不允许挂到两条本地订单上（重投下错单会多发一次积分）
    `pay_order_id`     VARCHAR(64)  NULL,
    `user_id`          BIGINT       NOT NULL,
    `tier_id`          BIGINT       NOT NULL,
    -- 实付金额，单位**分**（支付网关的记账单位；1 元 = 100 分）
    `amount_fen`       BIGINT       NOT NULL,
    -- 下单时冻结的到账积分（整数积分，与 billing 账本同单位）。
    -- ⚠️ 不是「按当前换算率现算」——那会让改口径影响已付款用户
    `credits`          BIGINT       NOT NULL,
    -- 冻结时生效的换算率（1 元 = 多少积分），仅用于事后回答「当时按什么算的」
    `credits_per_yuan` INT          NOT NULL,
    -- pending | paid | expired | failed —— paid 是「积分已发放」的唯一判据
    `status`           VARCHAR(16)  NOT NULL DEFAULT 'pending',
    `paid_at`          DATETIME(0)  NULL,
    -- billing 发放出的批次 id（对账：本地这条订单 ↔ 账本那一批积分）
    `grant_lot_id`     BIGINT       NULL,
    -- 最后一次向网关查单的时间。用户端每 3 秒轮询一次状态，若每次都去问网关，
    -- 一个用户就能打出每分钟 20 次查单；这个列让「多久查一次」由**库**说话而不是进程内存
    -- （多实例部署时进程内存各记各的，等于没限流）
    `last_query_at`    DATETIME(0)  NULL,
    -- 网关回调到达次数（含重投）。只做可观测，不参与判定——
    -- 判定一律看 status：数数只能说明「推了几次」，说明不了「发没发过」
    `notify_count`     INT          NOT NULL DEFAULT 0,
    `gmt_create`       DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`          INTEGER      NOT NULL DEFAULT 0,
    `is_delete`        TINYINT      NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_recharge_orders__trade_no`(`trade_no`),
    UNIQUE INDEX `uk_recharge_orders__pay_order_id`(`pay_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 系统设置：管理端可配、按模块存一行。目前三个模块：
--   credentials（商户凭证，**加密**）、policy（充值政策文案）、rateLimit（限流参数）。
--
-- 为什么按模块整行存而不是一个字段一行：一行 = 一个模块的一份完整快照，
-- 读的时候天然一致（不会读到「商户号改了、密钥没改」的中间态），写的时候一次成对。
--
-- ⚠️ `is_secret=1` 的行**必须**是密文（AES-256-GCM），明文的凭证不许落库：
--    本表的备份、从库、以及任何拿到库读权限的人都能看到它的内容。
--    密钥来自进程环境变量（`SYSTEM_SETTINGS_SECRET`），不在库里——库与密钥分开存放，
--    只拿到库读不到凭证。缺密钥时**拒写也拒用**（fail closed），不降级成明文。
CREATE TABLE `system_settings` (
    `setting_key`   VARCHAR(64)  NOT NULL,
    -- 模块快照（JSON 原文，或密文信封，见 is_secret）
    `setting_value` TEXT         NOT NULL,
    `is_secret`     TINYINT      NOT NULL DEFAULT 0,
    `gmt_create`    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`  DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `version`       INTEGER      NOT NULL DEFAULT 0,

    PRIMARY KEY (`setting_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
