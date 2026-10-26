-- 火山模型计费口径对账后的三处修正（数据，非结构）。
--
-- ── 依据 ──────────────────────────────────────────────────────────────────────
-- 火山方舟官方（公开披露）：
--   · 视频按 **token** 计费：token = 宽 × 高 × 帧率 × (输出时长 + 输入时长) ÷ 1024；
--     费用 = token ÷ 1,000,000 × 单价。Seedance 2.0 单价：**不含视频输入 46 元/百万token、
--     含视频输入 28 元/百万token**（480P）。官方明确「同等条件下高分辨率消耗更多 token」。
--   · 音频（Seed Audio 1.0）：**0.3 元/分钟**，按生成原始时长计费，精确到秒。
--   · 图片（Seedream）：按「张 × 分辨率档」。
--
-- 本迁移只改**与官方口径明确冲突**的三处；官方未公布数值的档位不动（宁缺毋滥）。
--
-- 前置校验（执行前人工确认，两条都须有输出）：
--   SELECT model_id, pricing FROM generation_model_capability WHERE model_id='doubao-seedance-2-0-260128';
--   SELECT model_id, pricing FROM generation_model_capability WHERE model_id='doubao-seedream-4-5-251128';
SET NAMES utf8mb4;

-- ① 视频 4K 单价**倒挂**：原值 390000/240000 mc = 26/16 元/百万token，**低于** 480P 的
--    46/28 元 —— 与官方「高分辨率 > 低分辨率」直接矛盾，且 4K 是最高档（像素数是 480P 的 20 倍）。
--    官方未公布 4K 单价，故取**相邻已确认更高档（1080P）的价**填平：只保证「单调不减」，
--    不凭猜测加价。待官方价目公布后再单独一版校正。
UPDATE `generation_model_capability`
SET `pricing` = JSON_SET(`pricing`,
      '$.basePrice.table."resolution=4k|video=0"', 765000,
      '$.basePrice.table."resolution=4k|video=1"', 465000)
WHERE `model_id` = 'doubao-seedance-2-0-260128'
  AND `is_delete` = 0;

-- ② Seedream 4.5 单价**内部不自洽**：原值 30000 mc = 2.0 元/张，
--    而同族的 4.0 是 0.2、5.0 是 0.12、5.0 Pro 上限 0.6 —— 4.5 比 5.0 Pro 上限还贵 3.3 倍。
--    官方 4.5 刊例价 0.25 元/张，故改为 0.25 元。
UPDATE `generation_model_capability`
SET `pricing` = JSON_SET(`pricing`, '$.basePrice.value', 3750)
WHERE `model_id` = 'doubao-seedream-4-5-251128'
  AND `is_delete` = 0;

-- ③ 清退役键 `tokenEstimate.dimensions`：输出像素表已搬进本行的 `features.video_dimensions`，
--    规则里那份**没有任何读方**，却会跟着规则快照冻进每一条预留行（实测 4 条视频行仍带着它）。
--    写闸门（`pricingFieldErr`）现已把它收成封闭键集，新增不会再有；这一句清存量。
UPDATE `generation_model_capability`
SET `pricing` = JSON_REMOVE(`pricing`, '$.tokenEstimate.dimensions')
WHERE JSON_EXTRACT(`pricing`, '$.tokenEstimate.dimensions') IS NOT NULL;
