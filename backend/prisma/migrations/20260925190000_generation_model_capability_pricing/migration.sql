-- generation_model_capability 增列 pricing：该模型该能力的计价规则。
--
-- ── 这一列是什么 ──────────────────────────────────────────────────────────────
-- JSON 形态与定价目录里 `document.models.<model_id>.<capability_type>` 那条**逐字相同**：
--
--   {baseUnit, basePrice:{kind,value?,by?,table?}, unitDenominator, minCredits,
--    maxCredits?, rounding?, dims?, multipliers?, tokenEstimate?}
--
-- 一条规则回答四件事：
--   · 按什么计量     baseUnit + unitDenominator —— 一次生成折算成几个计量单位；
--   · 单位价怎么来   basePrice.kind —— 固定值 / 按档位取（by）/ 查表（table）；
--   · 扣多少         minCredits 是单次下限，maxCredits 是单次上限（可空 = 不封顶）；
--   · 维度怎么参与   dims / multipliers 按维度乘系数；tokenEstimate 供 token 类计费预估。
--
-- ── 为什么从 billing 搬到这里 ─────────────────────────────────────────────────
-- 这条规则原先住在 billing 的定价目录（`billing_pricing_catalogs.document`）。
-- 搬过来的理由是：它本质上是**模型的属性** —— 改的是「这个模型怎么算钱」，
-- 谁定义模型谁就该定义它怎么计价，而不是记在计费引擎自己的目录里。
--
-- ── 数据主权边界不动 ─────────────────────────────────────────────────────────
-- billing 在**生成任务时**把这条规则随 Hold 请求一起带过去、存进自己的预留行，
-- 结算时用预留行那份快照 —— 所以 billing 不需要读 `blue_whale`，
-- 也不新增「计费反查模型库」的跨库依赖，数据主权边界与搬迁前一致。
--
-- ── ⚠️ 是 NULL 不是 NOT NULL ──────────────────────────────────────────────────
-- 过渡期定价目录里那份**仍在**（billing 侧回落到它），不是每个模型都已搬过来。
-- 设成 NOT NULL 会让所有尚未搬迁的模型写不进去 —— 也就没法分批搬。
-- 本列当前只承诺「有就用、没有就回落」；是否在搬迁收口时收紧，留给那一步再定。
SET NAMES utf8mb4;

ALTER TABLE `generation_model_capability`
  ADD COLUMN `pricing` JSON NULL
    COMMENT '该模型该能力的计价规则；JSON 形态与定价目录 document.models.<model_id>.<capability_type> 逐字相同。过渡期可为 NULL，billing 侧回落到定价目录'
    AFTER `request_mapping`;
