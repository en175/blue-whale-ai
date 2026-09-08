-- IK9VZ0：cost_reservations 增加 release_note（失败/取消释放的退款校验结果记录：
-- "refund_confirmed" 已确认 new-api 无扣费 / "refund_unverified" 未校验或可能已扣，供对账追溯）。
ALTER TABLE `cost_reservations`
    ADD COLUMN `release_note` VARCHAR(255) NULL;
