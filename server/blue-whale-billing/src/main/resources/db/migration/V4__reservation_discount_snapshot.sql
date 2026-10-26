-- 预扣时冻结的折扣（《计费逻辑详细设计》§2.6 注 / §4.3）
--
-- 背景：折扣规则存在两张 **live 表**（billing_promotions / billing_member_discounts），
-- 运营随时改、随时停；而结算发生在预扣之后几分钟到几十分钟。
-- 若不把「预扣时算出来的折扣」冻下来，结算重算会得到**不同的价**：
-- 一个在预扣后被停掉的活动，会让已经提交的任务按原价结算。
--
-- 这与 catalog_version 是同一件事的两半：
--   catalog_version 冻结「用哪套规则算」
--   discount_bp     冻结「当时打了多少折」
-- 少了任何一半，都复现不出预扣时那个价。
--
-- 存最终的**万分比系数**（已含叠加与底线），不存命中的活动 id 列表：
-- 结算只需要一个乘数；明细属于审计，那是账本与定价快照的事。

ALTER TABLE billing_cost_reservations
  ADD COLUMN discount_bp INT NOT NULL DEFAULT 10000
    COMMENT '预扣时的折扣系数（万分比，10000 = 原价）——结算按它复现，不重新解析'
    AFTER catalog_version;
