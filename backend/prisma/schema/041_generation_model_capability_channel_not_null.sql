-- generation_model_capability.channel 收成 NOT NULL：每一行都必须说清自己走哪个渠道。
--
-- ── 为什么现在能收 ────────────────────────────────────────────────────────────
-- 039 加列时是 `NULL`（那一步只做「加列 + 回填」），宽限期到此为止：
--   · 在用行（is_delete = 0）全部有值；
--   · 写路径（`parseChannelAndMapping`）**新建恒写**（按媒介取缺省）；
--   · 读侧的缺省回落仍在，但它从此是**防御直接改库**，不再是为存量兜底 —— 一行合法数据
--     不可能没有渠道，而「可空」会让这件事在类型上说不清。
--
-- 前置校验（执行前人工确认，须为 0）：
--   SELECT COUNT(*) FROM generation_model_capability WHERE is_delete = 0 AND channel IS NULL;
--
-- ⚠️ 软删行也会被下面这段补上：039 的回填带了 `is_delete = 0`，把软删行留成了空。
--    NOT NULL 是**表级**约束，不补它们就加不上；而软删行读不出来，按媒介给个缺省无害。
SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `channel` = CASE
  WHEN `capability_type` = 'video' THEN 'seedream-video'
  WHEN `capability_type` = 'audio' THEN 'seedream-audio'
  WHEN `capability_type` = 'text'  THEN 'seedream-text'
  ELSE 'seedream-image'
END
WHERE `channel` IS NULL;

ALTER TABLE `generation_model_capability`
  MODIFY COLUMN `channel` VARCHAR(32) NOT NULL
    COMMENT '渠道（<家族>-<媒介>[-<协议>]，封闭枚举）；决定请求怎么解析、出站用哪种线协议。本行解析与出站的唯一来源';
