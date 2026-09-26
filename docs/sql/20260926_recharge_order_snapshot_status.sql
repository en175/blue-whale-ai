-- 通用积分卡：订单快照补全 + 订单状态机从 4 态扩到 6 态
--
-- 背景（PRD §9.1 / §9.3，决定见 docs/specs 的落地记录）：
--   · 快照：下单时必须冻结当时的商品与活动，避免后台改配置影响已创建订单。
--     原有的 credits / credits_per_yuan / amount_fen 只是快照的一小半。
--   · 状态机：原 4 态（pending/paid/expired/failed）里，`paid` 同时表示「钱到了」与
--     「积分发了」。拆出「支付成功待到账」之后，「钱到了但没发成功」才第一次可表达 ——
--     在此之前那种单停在 `pending`，与「用户还没付钱」长得一模一样。
--
-- ⚠️ 刻意不建「已退款」状态：退款功能先不做（产品决定）。一个没有出口的状态就是死状态。

-- ── 订单状态：String 列，两个新值不需要 DDL，但要在这里把口径钉死 ──────────────
ALTER TABLE recharge_orders
  MODIFY COLUMN status VARCHAR(16) NOT NULL DEFAULT 'pending'
  COMMENT 'pending 待支付 | paid_pending 支付成功待到账 | paid 已到账 | failed 支付失败 | expired 已取消（用户取消或超时，沿用旧值不改名）| grant_failed 到账异常';

-- ── 快照补全（PRD §9.3）────────────────────────────────────────────────────
ALTER TABLE recharge_orders
  ADD COLUMN product_type VARCHAR(16) NOT NULL DEFAULT 'tier'
    COMMENT '商品类型快照：tier 固定积分卡 | custom 自定义充值',
  ADD COLUMN product_name VARCHAR(100) NOT NULL DEFAULT ''
    COMMENT '商品名称快照（如「轻量尝鲜」），不是外键——档位改名不该改写历史订单',
  ADD COLUMN bonus_credits BIGINT NOT NULL DEFAULT 0
    COMMENT '本单应发的赠送积分（首购加赠），没有则 0。与 credits 分开记，因为退款只退本金、且两者的有效期策略可能不同',
  ADD COLUMN credits_expire_at DATETIME NULL
    COMMENT '本单积分的到期时刻；NULL = 永久。存量行为是永久，2 年有效期落地后新单才会非空',
  ADD COLUMN first_purchase_state VARCHAR(16) NOT NULL DEFAULT 'unknown'
    COMMENT '下单时服务端判定的首购状态快照：unknown 未判定（首购功能未上线）| first 首购 | repeat 非首购',
  ADD COLUMN first_purchase_eligible TINYINT NOT NULL DEFAULT 0
    COMMENT '该商品是否参与首购加赠（配置快照）。与上面的 state 分开：一个说「人是不是首购」，一个说「这件商品参不参与」',
  ADD COLUMN permission_result VARCHAR(32) NOT NULL DEFAULT 'allowed'
    COMMENT '下单时的购买权限校验结果快照',
  ADD COLUMN config_version INT NOT NULL DEFAULT 0
    COMMENT '档位配置版本快照（下单时刻 topup_tiers.version 的值）。用它回答「这单是改价前还是改价后」——gmt_modified 只到秒，比不了';

-- ── topup_tiers.version 从死列变成真版本号 ─────────────────────────────────
-- 该列此前**零读零写**（与 billing 侧那个 version 列同款）。本次起：
-- 每次保存档位 +1，下单时冻结进 recharge_orders.config_version。
-- 没有列变更，只是赋予语义——记在这里是为了让下一个人知道它不再是装饰。
