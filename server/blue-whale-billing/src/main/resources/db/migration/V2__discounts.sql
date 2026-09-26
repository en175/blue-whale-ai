-- 折扣两张 live 表（《计费逻辑详细设计》§2.6 / §2.7）
--
-- ⚠️ **刻意与定价目录分开**：「基础计价」变更频率是**月/季度**，折扣是**每天**。
--    混在一份 catalog 文档里，运营每建一个活动就要发布一个新版本——
--    版本号爆炸、停一条活动要发整版、权限分不开。
--
-- ⚠️ **live 表，不版本化**：job 提交时把**命中结果**冻结进定价快照，
--    结算只复现快照。所以活动改折扣、停活动，都不影响已提交任务。
--    冻结的是「结果」而不是「规则」——这是它们不需要历史版本的原因。

-- ─────────────────────────────────────────────────────────────
-- 营销活动（运营日常操作，高频）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_promotions (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  code             VARCHAR(64)  NOT NULL COMMENT '活动标识，审计/排查用',
  name             VARCHAR(128) NOT NULL COMMENT '活动名称，前端展示（如「夜间 7 折」）',

  -- 万分比整数：7000 = 7 折。零浮点。
  discount_bp      INT          NOT NULL COMMENT '折扣，万分比',

  -- 营销的模型集合。支持通配：["seedance-*", "seedream-4.0"]
  model_ids        JSON         NOT NULL COMMENT '模型集合，支持 * 与 prefix-* 通配',
  task_types       JSON         NULL COMMENT '任务类型集合，NULL = 全部',

  -- 适用用户等级。NULL/空 = 不限等级
  tier_scope       JSON         NULL COMMENT '适用用户等级 ["pro","max"]，NULL = 不限',

  start_at         DATETIME     NOT NULL COMMENT '起始时间',
  end_at           DATETIME     NOT NULL COMMENT '结束时间',

  -- 可选时段：支持「夜间 7 折」这类。两个都为 NULL = 全天
  daily_time_start TIME         NULL COMMENT '每日时段起，NULL = 全天',
  daily_time_end   TIME         NULL COMMENT '每日时段止，可跨天（22:00→06:00）',
  days_of_week     JSON         NULL COMMENT '生效星期 [1..7]，NULL = 每天',

  -- ⚠️ 时区必填（ADR-0111 北京时间口径）。不写时区，跨零点时段必然算错。
  tz               VARCHAR(64)  NOT NULL DEFAULT 'Asia/Shanghai' COMMENT '时区',

  status           VARCHAR(16)  NOT NULL COMMENT 'draft | enabled | disabled | expired',
  priority         INT          NOT NULL DEFAULT 0 COMMENT '同折扣时的展示优先级',
  created_by       VARCHAR(64)  NOT NULL COMMENT '创建人',

  gmt_create       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version          INT          NOT NULL DEFAULT 0,

  PRIMARY KEY (id),
  UNIQUE KEY uk_promo__code (code),
  -- 命中判定走这条：status=enabled 且 now ∈ [start_at, end_at)
  KEY idx_promo__active (status, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='营销活动（live 表，不版本化）';

-- ─────────────────────────────────────────────────────────────
-- 会员等级折扣（长期契约，低频）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_member_discounts (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  tier          VARCHAR(24)  NOT NULL COMMENT 'free | basic | pro | max',
  model_pattern VARCHAR(128) NOT NULL COMMENT '模型匹配：seedance-* | * | gpt-4o',
  task_pattern  VARCHAR(64)  NOT NULL COMMENT '任务匹配：text2video | *',
  discount_bp   INT          NOT NULL COMMENT '折扣，万分比。9000 = 9 折',
  priority      INT          NOT NULL DEFAULT 0 COMMENT '同等级命中多条时取最优惠，此项仅用于展示排序',
  status        VARCHAR(16)  NOT NULL DEFAULT 'enabled' COMMENT 'enabled | disabled',

  gmt_create    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_member_disc__lookup (tier, status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员等级折扣（live 表）';
