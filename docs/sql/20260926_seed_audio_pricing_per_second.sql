-- 音频（Seed Audio 1.0）的计价口径对齐官方：**按次 → 按产出秒数**。
--
-- ── 依据（火山方舟官方公开披露）──────────────────────────────────────────────
--   Seed Audio 1.0：**0.3 元/分钟**，按模型**原始输出时长**计费、精确至秒折算；
--   单次输出上限 2 分钟。
--
-- ── 原值错在哪 ───────────────────────────────────────────────────────────────
-- 原 `constant:1` / 20000 mc = 20 积分 = **1.33 元/次** —— 按次，与实际时长**完全无关**。
-- 于是一段 3 秒的配音和一段 2 分钟的配音收一样的钱：
--   · 短音频（十几秒）超收几十倍；
--   · 长音频（接近 2 分钟，官方 0.6 元）少收一半以上。
-- 两种错都**在账面上看不出来**——这正是「按次」这个形态的盲区。
--
-- ── 换算 ─────────────────────────────────────────────────────────────────────
--   0.3 元/分钟 ÷ 60        = 0.005 元/秒
--   0.005 元/秒 × 15 积分/元 = 0.075 积分/秒
--   0.075 积分/秒 × 1000     = **75 mc/秒**（basePrice.value 的单位是 mc，与视频那条同口径）
--
-- ── maxCredits 为什么是必须的（不是可选调优）──────────────────────────────────
-- 按秒计价的**基准量在提交时刻取不到**：Seed Audio 是 TTS 式接口，时长由文案决定，
-- 请求里根本没有 duration 参数（见 002_seed.sql 的 IKG4UR 注与 supported_durations=NULL）。
-- billing 的 `Usage.contractFrom` 对此的立场是「拒绝，而不是按 0 冻」——
-- **只有规则配了上限，才转「按上限冻结、按实际结算」**（BillingApplicationService#priceAtCap）。
-- 所以：没配 maxCredits 的按秒音频规则 = 该模型**每一次提交都会被拒**（UNPRICEABLE 400）。
--
-- 上限取值：官方单次输出上限 2 分钟 = 120 s × 75 mc = 9000 mc = **9 积分**，这里配 **12 积分**。
--   · 多冻的部分在结算时**全额退回**（按真实秒数重算），所以「冻多了」不是多收；
--   · 反过来卡着 9 配，上游偶尔多吐一两秒就会走「结算超出预扣 → 差额记应收」，
--     那是**真少收**，且只在日志里留一条 WARN。留余量是为了不制造这种静默亏损。
--
-- ── 前置校验（执行前人工确认，须有输出）──────────────────────────────────────
--   SELECT model_id, capability_type, pricing FROM generation_model_capability
--    WHERE model_id = 'seed-audio-1.0';
SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `pricing` = JSON_OBJECT(
      'baseUnit', 'usage.seconds',
      'basePrice', JSON_OBJECT('kind', 'const', 'value', 75),
      'unitDenominator', 1,
      'minCredits', 1,
      'maxCredits', 12
    )
WHERE `model_id` = 'seed-audio-1.0'
  AND `capability_type` = 'audio'
  AND `is_delete` = 0;
