-- generation_model_capability 增列 channel：这个模型走哪个渠道。
--
-- ── 这一列是什么 ──────────────────────────────────────────────────────────────
-- 取值形如 `<家族>-<媒介>[-<协议>]`，**是能力行的封闭枚举**，不是自由文本：
--
--   seedream-image       seedream 4.0 / 4.5 / 5.0 / 5.0-pro
--   gpt-image            gpt-image-2-light（内联图片协议）
--   gpt-image-openai     gpt-image-2（官方 openai images 协议）
--   banana-image         nano-banana-2-t2i
--   seedream-video       seedance 2.0 / fast / mini / 2.5
--   seedream-audio       seed-audio-1.0
--   seedream-text        MiniMax-M3 / doubao-seed-evolving / …
--
-- 它回答一件事：**这个模型的请求怎么解析、出站用哪种线协议**。
-- 按媒介分的那三段（video / audio / text）没有解析器与协议之分，它们的渠道就是媒介本身。
--
-- ── 为什么取代 channel_parser + features.image_protocol ──────────────────────
-- 那两个字段说的是同一件事的两半，却住在两个地方、两种形态：
--   · `channel_parser`（本表的**列**）—— seedream / gpt / banana，图片请求字段的映射策略；
--   · `features.image_protocol`（**JSON 键**）—— inline-image / openai-images，出站线协议。
-- 于是「同一个渠道」被拆成两个字段，运营在界面上看到两个像重复的控件；
-- 而「解析器 → 读 request_mapping 的哪一部分」这层映射，在两个语言里被写了多遍。
-- 合成一列之后：一个模型一个渠道，渠道决定解析与出站；一个概念只有一处。
--
-- ⚠️ 协议**并进取值**而不是另开一列：`gpt-image`（内联）与 `gpt-image-openai`（官方协议）
--    是两个渠道，不是同一个渠道的两个开关。这样「一个渠道一套行为」始终成立，
--    不会退化回「两个字段自由组合」——那正是这次要消灭的形态。
--
-- ── 为什么是 NULL 而不是 NOT NULL ─────────────────────────────────────────────
-- 本迁移**只加列 + 回填**，不回填不到的行留 NULL。收紧要等旧字段真正退场之后单独一版，
-- 那时才有把握说「所有行都有渠道」。现在就 NOT NULL 会让尚未盘点到的存量写不进去。
--
-- ── ⚠️ 本迁移不碰 channel_parser / features.image_protocol 一个字 ─────────────
-- 上线顺序是硬要求，兼容窗口在这里：
--   ① 本迁移先跑（加列 + 回填）——此时**旧字段一字未动**；
--   ② worker-java 随后上线（它**现查库**读能力行，不读冻结快照）——窗口里旧 worker
--      仍读 channel_parser + features.image_protocol，行为与迁移前**逐字相同**；
--   ③ 新 worker 上线后才切到读 channel，旧字段此后「只写不读」；
--   ④ 再下一个发布周期，才单开一条迁移删旧列。
-- 所以**这条迁移里不能出现任何 DROP / MODIFY**：删早了，窗口里的旧 worker 直接读空。
--
-- ── 回填口径（与两个读侧的既有缺省逐字一致）────────────────────────────────────
--   · `channel_parser` 为空/认不出 → 当 `seedream`（`model-capability-repo.ts` 与
--     `model-capability-admin-repo.ts` 两处读侧都这么归一）；
--   · `image_protocol` 不存在/为空/认不出 → 当 `inline-image`（worker 的
--     `ImageChannelMapper.parseImageProtocol` 明写「没配 = 缺省，不吵」）。
-- 认不出的解析器值落到 `seedream-image`（而不是 gpt）—— 与读侧同口径，取更保守的那个。
--
-- ⚠️ **不按 provider_id 过滤**：存量里 provider_id 的实际取值与预期不符（IKHEXG 那次
--    迁移踩过：线上是 `volcengine` 而不是 `new-api`），按它过滤会静默漏掉整批行。
SET NAMES utf8mb4;

ALTER TABLE `generation_model_capability`
  ADD COLUMN `channel` VARCHAR(32) NULL
    COMMENT '渠道（<家族>-<媒介>[-<协议>]，封闭枚举）；决定请求怎么解析、出站用哪种线协议。取代 channel_parser + features.image_protocol，过渡期可为 NULL'
    AFTER `channel_parser`;

-- 回填：媒介优先（video/audio/text 的渠道就是媒介，没有解析器与协议之分），
-- 图片行再按解析器 → 协议两级细分。
UPDATE `generation_model_capability`
SET `channel` = CASE
  WHEN `capability_type` = 'video' THEN 'seedream-video'
  WHEN `capability_type` = 'audio' THEN 'seedream-audio'
  WHEN `capability_type` = 'text'  THEN 'seedream-text'
  WHEN COALESCE(NULLIF(`channel_parser`, ''), 'seedream') = 'banana' THEN 'banana-image'
  WHEN COALESCE(NULLIF(`channel_parser`, ''), 'seedream') = 'gpt'
       AND COALESCE(
             NULLIF(JSON_UNQUOTE(JSON_EXTRACT(`features`, '$.image_protocol')), ''),
             'inline-image'
           ) = 'openai-images'
    THEN 'gpt-image-openai'
  WHEN COALESCE(NULLIF(`channel_parser`, ''), 'seedream') = 'gpt' THEN 'gpt-image'
  ELSE 'seedream-image'
END
WHERE `is_delete` = 0 AND `channel` IS NULL;
