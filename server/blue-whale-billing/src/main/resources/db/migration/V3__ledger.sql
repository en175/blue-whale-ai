-- 积分账户与复式账本（《计费逻辑详细设计》§7.2 / §7.3 / §数据表结构说明 §2.1–§2.4）
--
-- 三张表的分工：
--   billing_credit_lots       积分**批次**——带来源与有效期，是余额的唯一权威
--   billing_ledger_entries    复式账本——append-only，财务与审计的权威
--   billing_cost_reservations 预扣预留——含 allocations，结算按它精确解冻

-- ─────────────────────────────────────────────────────────────
-- 积分批次
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_credit_lots (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  user_id      BIGINT       NOT NULL,

  -- 来源。决定①扣减优先级 ②财报口径（付费=收入 / 赠送=成本）③有效期策略
  -- register | daily | invite | redeem | purchased | bonus | subscription | gift | compensation
  source       VARCHAR(24)  NOT NULL COMMENT '积分来源，见 CreditSource 枚举',

  -- ★ CreditSource.priority 的冗余列，**专为扣减顺序的 ORDER BY 而加**。
  --   不加的话 SQL 里要用 FIELD(source, 'compensation','bonus',...) 硬编码优先级，
  --   枚举一改就静默错位；加了列则顺序由插入时决定，且能走复合索引。
  source_priority INT       NOT NULL COMMENT '扣减优先级（数值小者先扣），取自 CreditSource',

  amount       BIGINT       NOT NULL COMMENT '发放总量（积分），发放后不变',
  remaining    BIGINT       NOT NULL COMMENT '剩余总量（积分），含冻结',
  frozen       BIGINT       NOT NULL DEFAULT 0 COMMENT '冻结中（积分）',

  -- NULL = 永久。扣减按 expires_at ASC（先过期先扣），过期靠查询条件排除，
  -- **不需要定时任务删**（定时任务会锁表、会因漏跑而不一致；查询条件永不出错）
  expires_at   DATETIME     NULL COMMENT 'NULL = 永久',

  biz_type     VARCHAR(32)  NOT NULL COMMENT '来源业务类型：order | grant | migrate',
  biz_id       VARCHAR(128) NOT NULL COMMENT '来源业务 id',

  -- 发放幂等键。重复发放靠它拦（唯一索引），不靠应用层判重
  grant_key    VARCHAR(190) NOT NULL COMMENT '发放幂等键',

  gmt_create   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version      INT          NOT NULL DEFAULT 0,

  PRIMARY KEY (id),
  UNIQUE KEY uk_lots__grant_key (grant_key),
  -- 余额聚合 + 临期查询
  KEY idx_lots__user_expiry (user_id, expires_at),
  -- 扣减顺序的第三级 tie-break（id ASC）
  KEY idx_lots__user_id (user_id, id),

  -- ★ 不变量：0 ≤ frozen ≤ remaining ≤ amount
  CONSTRAINT ck_lots__bounds CHECK (
    remaining >= 0 AND frozen >= 0 AND remaining <= amount AND frozen <= remaining
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='积分批次（余额唯一权威）';

-- ─────────────────────────────────────────────────────────────
-- 复式账本
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_ledger_entries (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  user_id         BIGINT       NOT NULL,

  -- wallet | frozen | revenue | cost | receivable
  account         VARCHAR(24)  NOT NULL COMMENT '会计科目',
  direction       VARCHAR(8)   NOT NULL COMMENT 'debit（借）| credit（贷）',

  amount          BIGINT       NOT NULL COMMENT '恒正；方向由 direction 表达',

  -- hold | settle | refund | recharge | grant | expire | adjust
  biz_type        VARCHAR(32)  NOT NULL,
  biz_id          VARCHAR(128) NOT NULL,

  -- ★ 幂等键。重复请求靠唯一索引拦下，不靠应用层判重（应用层判重有 TOCTOU 窗口）
  idempotency_key VARCHAR(190) NOT NULL,

  -- ★ 该科目变动后余额快照。作用：对账时**逐笔可验证** ——
  --   prev.balance_after ± amount == cur.balance_after 不成立即定位到具体分录，
  --   而不是只知道总数不平
  balance_after   BIGINT       NOT NULL,

  remark          VARCHAR(255) NOT NULL DEFAULT '',
  gmt_create      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uk_ledger__idem (idempotency_key),
  KEY idx_ledger__user_time (user_id, gmt_create),
  KEY idx_ledger__biz (biz_type, biz_id),
  -- ★ 每次记账都要读「该 (user, account) 的上一笔余额」来算 balance_after。
  --   没有这个索引就是扫该用户的全部分录——用户越活跃越慢，且慢在写路径上。
  KEY idx_ledger__user_account (user_id, account, id),

  -- append-only：不 UPDATE、不 DELETE。冲正靠**反向分录**，不靠改历史
  CONSTRAINT ck_ledger__amount_positive CHECK (amount > 0),
  CONSTRAINT ck_ledger__direction CHECK (direction IN ('debit', 'credit'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='复式账本（append-only）';

-- ─────────────────────────────────────────────────────────────
-- 预扣预留
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_cost_reservations (
  id               BIGINT       NOT NULL AUTO_INCREMENT,
  generation_job_id BIGINT      NOT NULL,
  user_id          BIGINT       NOT NULL,

  reserved_credits BIGINT       NOT NULL COMMENT '预扣额（积分）',
  actual_credits   BIGINT       NULL COMMENT '实际额（积分），结算后填',

  -- held | settled | released
  status           VARCHAR(32)  NOT NULL COMMENT 'held / settled / released',

  -- ★ 预扣时分配到哪些批次的哪些数量：[{"lotId":1,"take":3000}]
  --   结算与返还**必须按同一份明细**解冻与扣减 —— 否则会扣错批次
  --   （期间可能插入新批次或旧批次过期，重算分配会得到不同结果）
  allocations      JSON         NOT NULL COMMENT '预扣分配明细',

  catalog_version  INT          NOT NULL COMMENT '冻结的定价版本',

  release_note     VARCHAR(255) NULL COMMENT '释放原因',

  gmt_create       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  version          INT          NOT NULL DEFAULT 0,

  PRIMARY KEY (id),
  UNIQUE KEY uk_reservation__job (generation_job_id),
  KEY idx_reservation__status (status, gmt_modified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预扣预留（内部，不暴露给用户端）';
