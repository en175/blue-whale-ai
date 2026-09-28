-- 通用积分卡：自定义充值（模块 B）——配置表 + 订单不再强绑档位。
--
-- 依据 PRD §7（模块 B 全文）/ §10.3（自定义充值配置字段表）/ §9.3（订单快照）/ §9.4（到账规则）。
--
-- ── 为什么是**独立的单行表**而不是塞进 `system_settings` ─────────────────────────
-- `system_settings` 存的是**凭证**：值走 AES 加密、带 `is_secret` 标记、有轮换语义
-- （换密钥要重写全部密文行）。自定义充值的上下限/换算率是**商品配置**，明文、要按字段
-- 查询与校验、随运营调价高频变更。两者混在一张表里，迟早有人给商品配置也套上加密，
-- 或者把凭证当成一份普通 JSON 去解析。所以：独立的表、独立的读写路径。
--
-- 单行（`id` 恒为 1、主键钉住）而不是「一个字段一行」：PRD §10.3 的九个字段是**一份完整口径**，
-- 分开存会出现「下限改了、上限还是旧的」那种中间态被读到。整行读、整行写，天然一致。
--
-- ── 为什么 `recharge_orders.tier_id` 要改成可空 ────────────────────────────────
-- 自定义充值**没有档位**。`tier_id NOT NULL` 逼着写入侧编一个（0？1？），
-- 而编出来的那个数在任何后续查询里都会被当成一个真档位（对账按 tier_id 聚合时，
-- 全部自定义充值会聚到某个无辜档位上）。可空才是诚实的：NULL = 这单不是档位商品。
-- 商品类型本来就有快照列 `product_type`（tier | custom），判据以它为准。
--
-- ── 换算率（`credits_per_yuan`）是**本表自己的**，与消费锚点不是一回事 ─────────────
-- 定价目录里那条「1 元 = N 积分」是**消费**锚点（生成任务扣分用），
-- 模块 A 的裁定已经写死：档位到账积分读 `topup_tiers.base_credits` 配置值，
-- 与换算率**再无数学关系**。自定义充值是**唯一**真的用这条比例算价格的地方：
--   `价格(分) = round(积分数 × 100 ÷ 每元积分数)`
-- PRD §7.1 也明说自定义充值默认按「1 元 = 15 积分」，与现有展示口径不一致（§13.2 待评审）。
-- 所以本表另存一份，且**下单时把用哪条比例写进订单行**（`credits_per_yuan` 快照）。
--
-- ── 保存时的整除校验为什么必须在服务端 ────────────────────────────────────────
-- PRD §7.1 自己注明「最高…需能被换算比例整除」，而换算比例是**可配的**——
-- 运营把比例从 15 改成 7，原来那组 600 / 499995 / 600 立刻不再整分。
-- 这个校验放在服务端（见 `validateCustomConfig`），不放在表单里：
-- 表单校验过不了 API 直连，而一条配歪的配置会让用户下单时报一个「价格算不出来」的错。
SET NAMES utf8mb4;

CREATE TABLE `recharge_custom_config` (
    -- 恒为 1：单行表，主键把「只有一份配置」这件事钉在 DDL 上（不是靠约定）
    `id`                     INT          NOT NULL,
    -- 最低/最高/默认积分（整数积分，与 billing 账本同单位）。PRD §7.1 默认 600 / 499995 / 600
    `min_credits`            BIGINT       NOT NULL DEFAULT 600,
    `max_credits`            BIGINT       NOT NULL DEFAULT 499995,
    `default_credits`        BIGINT       NOT NULL DEFAULT 600,
    -- 每元积分数（PRD §7.1 默认 15）。**本表的价格算法输入**，不是消费锚点，见文件头
    `credits_per_yuan`       INT          NOT NULL DEFAULT 15,
    -- 积分步长（PRD §10.3）：滑杆步进与手输修正用。默认 15 = 每步 1 元。
    -- 约束见服务端校验：min 与 max 之间的距离、default 与 min 的距离都必须是它的整数倍，
    -- 否则滑杆推不到两端 —— 那会让「最高 499,995」这句话在界面上不成立
    `step_credits`           BIGINT       NOT NULL DEFAULT 15,
    -- 是否启用（PRD §10.3「控制用户侧是否展示自定义充值」）。0 = 用户侧不展示、下单被拒
    `enabled`                TINYINT      NOT NULL DEFAULT 1,
    -- 购买权限（PRD §10.3「与固定积分卡一致」）。枚举与 topup_tiers.permission **同一套**：
    -- all 全部登录用户 | user_group 指定用户群 | member_tier 指定会员等级（阶段 2 生效，先占位）
    `permission`             VARCHAR(16)  NOT NULL DEFAULT 'all',
    -- 白名单：JSON 数组，元素是 userId 的**十进制字符串**（BigInt 超 JS 安全整数，存串不丢精度）
    `permission_allowlist`   JSON         NULL,
    -- 无权限提示（PRD §10.3 选填）。空串 = 用前端默认文案
    `permission_denied_hint` VARCHAR(255) NOT NULL DEFAULT '',
    -- 到账积分有效期，单位**月**（PRD §10.3 默认 2 年 = 24 个月；§9.5 按支付成功时间起算）。
    -- 与 topup_tiers.credits_valid_months 同口径（口径钉死为月：年表达不了 6/18 个月）
    `credits_valid_months`   INT          NOT NULL DEFAULT 24,
    -- 配置版本：**每保存一次 +1**。下单时快照进 recharge_orders.config_version，
    -- 回答「这单是调价前还是调价后下的」
    `version`                INT          NOT NULL DEFAULT 0,
    `gmt_create`             DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `gmt_modified`           DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 初始化唯一那行：PRD §7.1 的默认配置。
-- ⚠️ 这是**初始值**，不是写死：代码里没有任何地方引用下面这些数字，读路径读的是表里的行。
--    运营在后台改完就是改完了，重跑本迁移也不会覆盖（迁移只跑一次）。
-- ⚠️ `enabled = 1`（默认对用户可见）：PRD §7.1 的默认配置就是「可用」的那一份，
--    种子若默认关着，新环境部署完看不到任何效果，还要人去后台点一下才知道有这功能。
INSERT INTO `recharge_custom_config`
  (`id`, `min_credits`, `max_credits`, `default_credits`, `credits_per_yuan`, `step_credits`,
   `enabled`, `permission`, `permission_allowlist`, `permission_denied_hint`,
   `credits_valid_months`, `version`)
VALUES
  (1, 600, 499995, 600, 15, 15, 1, 'all', NULL, '', 24, 0);

-- ── 自定义充值没有档位：`tier_id` 改成可空 ──────────────────────────────────────
-- NULL 的含义是「这单不是档位商品」（`product_type = 'custom'`），不是「档位被删了」。
-- 档位被删走的是 `topup_tiers.is_delete = 1`，订单行上的 tier_id 不受影响。
ALTER TABLE `recharge_orders`
  MODIFY COLUMN `tier_id` BIGINT NULL
    COMMENT '档位 ID。**可空**：NULL = 这不是档位商品（自定义充值，product_type=custom）。自定义充值没有档位，编一个 0/1 出来会被后续按 tier_id 聚合的对账当成真档位';
