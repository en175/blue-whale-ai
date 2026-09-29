-- Seedance 2.5 视频默认比例改 `adaptive`（跟随输入）——数据迁移，非结构。
--
-- ── 为什么 ────────────────────────────────────────────────────────────────────
-- 2.5 的比例档里本就有 `adaptive`（跟随输入）。此前默认值是 `16:9`，于是每次打开视频面板
-- 都先落在一个固定比例上，用户要「跟随输入」得自己再选一次。改为默认 `adaptive` 后，
-- 支持该档的模型默认选中「跟随输入」（IKJ4W6）。
--
-- ── 为什么叫 adaptive 而界面写 auto ───────────────────────────────────────────
-- 只改**默认值**，不改键名：发给上游火山的报文里 `ratio` 必须是 `adaptive`
-- （worker 侧 NewApiVideoClient 强制 `ratio=adaptive`，否则回 provider_failed）。
-- 界面文案由 Web 侧显示映射把 `adaptive` 渲染成 `auto`，两者不可互换。
--
-- ── 影响面 ────────────────────────────────────────────────────────────────────
-- 读侧唯一消费点：`handle-list-models.ts` 把 `default_aspect_ratio` 作为默认 `ratioId`
-- 透出给前端——改这一列即前后端默认选中同步生效，无需改代码。
-- 只动 2.5 一行；2.0 系列不支持 adaptive，保持 `16:9`。
--
-- ── 前置校验（执行前人工确认）─────────────────────────────────────────────────
--   SELECT model_id, default_aspect_ratio, supported_aspect_ratios
--   FROM generation_model_capability
--   WHERE model_id = 'doubao-seedance-2-5-260628';
--   -- supported_aspect_ratios 必须含 'adaptive'（否则默认值会落到非法档）
SET NAMES utf8mb4;

UPDATE `generation_model_capability`
SET `default_aspect_ratio` = 'adaptive'
WHERE `model_id` = 'doubao-seedance-2-5-260628'
  AND `is_delete` = 0;
