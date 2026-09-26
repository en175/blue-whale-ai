-- Seedream 5.0 Pro 的计价补齐**第二项**：参考图按张收费（首张免费、第 2 张起 0.02 元/张）。
--
-- ── 依据（火山方舟官方，多来源一致）────────────────────────────────────────────
--   Doubao-Seedream-5.0-pro（本行 model_id `doubao-seedream-5-0-pro-260628`）：
--     输出图  ≤236 万像素 → 0.30 元/张；>236 万像素 → 0.60 元/张
--     输入图（参考图）**首张免费，第 2 张起 0.02 元/张**
--   例：传满 10 张参考图、输出一张 1536×1536 → 0.30 + 9 × 0.02 = **0.48 元**。
--
-- ── 本次只加第二项；输出档一个数都不动 ──────────────────────────────────────
-- 输出档今天就是对的：`size=1k|1.5k` = 1536² = 235.9 万像素 ≤ 236 万 → 0.3 元；
-- `size=2k` = 2048² = 419 万 > 236 万 → 0.6 元。与官方分档逐项吻合。
--
-- ── dimPrices 是什么，为什么不能用 dims ──────────────────────────────────────
-- `dims` 是**相对**量：`units += 张数 × 万分比`，再 `× basePrice`。于是「每张多少钱」
-- = 万分比 × basePrice —— **随 basePrice 变**。这条规则的 basePrice 有两个档
-- （3000 / 6000 mc），同一个「0.02 元」在 0.3 档要 667 万分比、在 0.6 档要 333 万分比，
-- **一个字段表达不了**。`dimPrices` 是**绝对**加价，与 basePrice 解耦：
--   mc = max(0, 参考图张数 - 1) × unitMc     ← firstFree 就是那个「首张免费」的 -1
--
-- 换算：0.02 元 × 15 积分/元 × 1000 mc/积分 = **300 mc**。
--
-- ── 必须与另一处口径同时成立（否则这项永远不会生效）────────────────────────
-- 图片单的参考图冻结在 `input.input_asset_ids`（不是 `references`），而改造前
-- `reference_count` 只数 `references` ⇒ **图片单的参考数恒为 0** ⇒ 这一项收不到钱。
-- 本次一并修了 Hold（`billing-specs.ts`）、Quote（`projectQuoteInput`）与
-- 结算（`SettlementUsageLines`）三处，三处逐条同口径。
--
-- ── 前置校验（执行前人工确认，须有输出）──────────────────────────────────────
--   SELECT model_id, pricing FROM generation_model_capability
--    WHERE model_id = 'doubao-seedream-5-0-pro-260628';
SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.succeededSlots',
      'basePrice', JSON_OBJECT(
          'kind', 'table',
          'by', JSON_ARRAY('size'),
          'table', JSON_OBJECT('size=1k', 4500, 'size=1.5k', 4500, 'size=2k', 9000)
      ),
      'dimPrices', JSON_OBJECT(
          'usage.referenceCount', JSON_OBJECT('unitMc', 300, 'firstFree', TRUE)
      ),
      'unitDenominator', 1,
      'minCredits', 1
    )
WHERE `model_id` = 'doubao-seedream-5-0-pro-260628'
  AND `capability_type` = 'image'
  AND `is_delete` = 0;
