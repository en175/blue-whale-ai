-- 通用积分卡：固定档位字段扩展（模块 A）+ 上架状态三态
--
-- 依据 PRD §6（模块 A）/ §10.2（配置字段表）/ §10.4（权限配置）/ §10.5（发布规则）。
--
-- ── 上架状态三态（PRD §10.5「新建卡片默认草稿，不展示给用户」）──────────────────
-- `status` 由 active|inactive 加一个 draft 值，并把**列默认值改成 draft**：
-- 草稿不进用户侧（列档位的读路径只认 active），运营把 6 个档位配齐再逐个上架。
-- ⚠️ **存量行一律不动**：它们已经是上架/下架，没有理由回退成草稿 ——
-- 改的只是「此后新插入且未显式给状态时取什么值」，不是任何一行的现值。
--
-- ── 购买权限（PRD §10.4）──────────────────────────────────────────────────
-- 枚举先占三档：all 全部登录用户 | user_group 指定用户群 | member_tier 指定会员等级。
-- member_tier 是阶段 2 的事，**本阶段只占位、不生效** —— 现在把值写进列定义，
-- 将来接会员模块时加的是判断逻辑，不是 DDL。
--
-- ── 支付价格与基础积分仍是派生量 ─────────────────────────────────────────────
-- price = original_price × discount、amount = original_price × 换算率。
-- 两者**不新增列、也不当表单输入框**：原价与折扣才是运营的输入，其余是算出来的。
-- （本迁移不动这两列，写在这里是因为 PRD §10.2 的字段表里它们占了两行。）

SET NAMES utf8mb4;

-- ── 上架状态：加 draft 值，默认改草稿 ────────────────────────────────────────
ALTER TABLE topup_tiers
  MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'draft'
    COMMENT 'draft 草稿（新建默认，用户侧不展示）| active 上架 | inactive 下架';

-- ── 卡片展示与首购活动字段（PRD §10.2）──────────────────────────────────────
ALTER TABLE topup_tiers
  ADD COLUMN description VARCHAR(255) NOT NULL DEFAULT ''
    COMMENT '卡片说明（PRD §10.2）。选填 → 空串表示未填',
  ADD COLUMN bonus_credits BIGINT NOT NULL DEFAULT 0
    COMMENT '首购/活动赠送积分（PRD §10.2）。只有「参与首购」且用户满足首购条件时才发放；0 = 不赠送',
  ADD COLUMN activity_tag VARCHAR(64) NOT NULL DEFAULT ''
    COMMENT '活动标签（PRD §10.2），如「首购加赠 50%」。已首购用户侧隐藏；空串 = 无标签',
  ADD COLUMN button_text VARCHAR(32) NOT NULL DEFAULT '立享加赠'
    COMMENT '购买按钮文案（PRD §10.2「按钮文案」，默认「立享加赠」）',
  ADD COLUMN first_purchase_eligible TINYINT NOT NULL DEFAULT 0
    COMMENT '是否参与首购（PRD §10.2「是否参与首购」）。与 recharge_orders.first_purchase_eligible 同义：下单时把本列快照进订单',
  ADD COLUMN credits_valid_months INT NOT NULL DEFAULT 24
    COMMENT '到账积分有效期，单位**月**（PRD §10.2「积分有效期」默认 2 年 = 24 个月；§9.5 按支付成功时间起算）。口径钉死为月：年表达不了 6/18 个月这类档位',
  ADD COLUMN permission VARCHAR(16) NOT NULL DEFAULT 'all'
    COMMENT '购买权限（PRD §10.4）：all 全部登录用户 | user_group 指定用户群 | member_tier 指定会员等级。⚠️ member_tier 阶段 2 才生效，此处先占位',
  ADD COLUMN permission_allowlist JSON NULL
    COMMENT '购买权限白名单（PRD §10.4「指定用户群」）：JSON 数组，元素是 userId 的**十进制字符串**（userId 是 BigInt，超出 JS 安全整数范围，存字符串不丢精度）。NULL = 未配置',
  ADD COLUMN permission_denied_hint VARCHAR(255) NOT NULL DEFAULT ''
    COMMENT '无权限提示（PRD §10.2「无权限提示」）。空串 = 用前端默认文案';
