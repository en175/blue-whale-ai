-- generation_model_capability 删列 channel_parser，并清掉 features.image_protocol 键。
--
-- ── 这两处是什么 ──────────────────────────────────────────────────────────────
-- 它们说的是同一件事的两半，却住在两个地方、两种形态：
--   · `channel_parser`（本表的**列**）—— seedream / gpt / banana，图片请求字段的映射策略；
--   · `features.image_protocol`（**JSON 键**）—— inline-image / openai-images，出站线协议。
-- 039 加了 `channel` 列（`<家族>-<媒介>[-<协议>]`）并把两者合成一个概念之后，它们就成了
-- **派生镜像**：解析器与协议都能从渠道算出来，两处读方也都切走了
-- （backend `parseStoredChannel` / worker-java `ImageChannelMapper.parseChannel`）。
-- 留着它们，只会让「改了一个忘了另一个」重新成为可能。
--
-- ── 与 039 的关系 ────────────────────────────────────────────────────────────
-- 039 加 `channel` 并回填，本迁移删掉那两处旧字段。两者与 worker-java / backend 的新版本
-- **同一批上线**（全仓一起发），所以中间不存在「迁移跑了、代码还没换」的空档。
--
-- ── ⚠️ 本迁移不碰 request_mapping ────────────────────────────────────────────
-- `request_mapping` 是**数据**（哪张映射表长什么样），不是一个能从渠道推导出来的值。
-- 渠道只回答「用哪套」，不回答「长什么样」。
--
-- ── 前置校验（执行前人工确认，两处都须为 0）──────────────────────────────────
--   SELECT COUNT(*) FROM generation_model_capability WHERE is_delete = 0 AND channel IS NULL;
--   SELECT COUNT(*) FROM generation_model_capability WHERE channel_parser NOT IN ('seedream','gpt','banana');
SET NAMES utf8mb4;

-- 先清 features 里的退役键，再删列。
-- 两句都幂等，重跑无害；顺序固定（先清键）是为了让「删列失败」的那次重跑仍留下一个干净的数据面。
UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(`features`, '$.image_protocol', '$.imageProtocol')
WHERE `features` IS NOT NULL
  AND JSON_TYPE(`features`) = 'OBJECT'
  AND (
        JSON_EXTRACT(`features`, '$.image_protocol') IS NOT NULL
     OR JSON_EXTRACT(`features`, '$.imageProtocol') IS NOT NULL
  );

ALTER TABLE `generation_model_capability`
  DROP COLUMN `channel_parser`;
