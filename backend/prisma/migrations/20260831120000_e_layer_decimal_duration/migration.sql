-- E 层：topup_tiers 金额 Float → Decimal + assets 合并 duration → duration_ms。
-- 前置校验（执行前人工确认，任一非 0 须先处置再执行）：
--   SELECT COUNT(*) FROM topup_tiers WHERE ROUND(original_price,2) <> original_price;  -- 须为 0
--   SELECT COUNT(*) FROM topup_tiers WHERE ROUND(price,2) <> price;                    -- 须为 0
--   SELECT COUNT(*) FROM topup_tiers WHERE discount < 0 OR discount > 1;               -- 须为 0（discount ∈ [0,1]）
--   SELECT COUNT(*) FROM topup_tiers WHERE original_price > 99999999.99;               -- 须为 0（decimal(10,2) 上限）
--   SELECT COUNT(*) FROM topup_tiers WHERE price > 99999999.99;                        -- 须为 0
--   SELECT COUNT(*) FROM assets WHERE duration_ms IS NULL AND duration IS NOT NULL;     -- 回填候选（迁移会回填）

-- ============================================================
-- E1: assets 合并 duration → duration_ms
-- 顺序：先回填（旧 duration 秒 → duration_ms 毫秒）→ 再 DROP COLUMN duration。
-- 消费端自本会话起全部只写 duration_ms；duration 为历史兜底列，回填后无引用即删。
-- ============================================================
UPDATE `assets` SET `duration_ms` = `duration` * 1000
  WHERE `duration_ms` IS NULL AND `duration` IS NOT NULL;
ALTER TABLE `assets` DROP COLUMN `duration`;

-- ============================================================
-- E2: topup_tiers 金额 Float → Decimal（无损：写入侧已 round 到 2dp）
--   original_price/price: DOUBLE → DECIMAL(10,2)
--   discount: DOUBLE → DECIMAL(5,4)（存量如 0.01 / 0.85，4dp 精度足够）
-- ============================================================
ALTER TABLE `topup_tiers`
  MODIFY COLUMN `original_price` DECIMAL(10, 2) NOT NULL,
  MODIFY COLUMN `discount` DECIMAL(5, 4) NOT NULL DEFAULT 1,
  MODIFY COLUMN `price` DECIMAL(10, 2) NOT NULL;
