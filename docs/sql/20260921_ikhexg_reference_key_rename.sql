-- IKHEXG：能力行参考上限键名统一——`max_reference_images` 并入 `image_reference_max`。
--
-- 问题：两把键**字面几乎一样、语义却不同**，且没有任何机制强制统一：
--   * `max_reference_images`（缺省 10）—— 图片 / 视频生成里的图参考上限
--   * `image_reference_max`（缺省 1）—— 当时只服务音频生成
-- 已实际造成误判与错配（均以种子为证）：
--   * `gpt-image-2`（图片行）同时带 `max_reference_images:16` 与 `image_reference_max:1`——
--     后者在图片行上根本不被读，是死值；
--   * `doubao-seedance-2-5`（视频行）把图参考 **30** 写在 `image_reference_max` 上——视频链路
--     不读它，**实际生效的是缺省 10**，而生产清单要求 30。
-- 合一后键名只表达**素材媒介**，作用域由行的 capability_type 与调用点决定。
--
-- 本迁移做三件事（**按行类型保留原本生效的那把键**）：
--   (1) 非音频行：把旧键 `max_reference_images` 的值搬进 `image_reference_max`，删旧键；
--   (2) 同上，兼容 camelCase 历史键形 `maxReferenceImages`；
--   (3) 残余旧键一律删除——音频行上的旧键本来就是死值（音频链路读的是 `image_reference_max`）。
-- 三步之后代码里 `max_reference_images` 不再有生产者，库里的遗留值也被清掉。
--
-- ⚠️ 「只搬值、不改语义」对**绝大多数行**成立，但不是全部：非音频行若只有新键、没有旧键，
--    它的 `image_reference_max` 在本迁移之前**根本不被那张链路读**，生效值是缺省 10；迁移后被
--    扶正成配置值，行为随之改变（seed 里 seedance-2-5 的图参考 30 即此类，属修复）。pre-flight
--    第二问专门列出这批行，请逐行确认新值是想要的。
--
-- ⚠️ 判定「哪个值原本生效」的依据是**行类型**：行的 capability_type 决定哪把键被读，因此两键
--    同现时保留原本被读的那把，行为逐字不变。这一点机器能安全推断（不是猜语义）。
--
-- ⚠️ **上线顺序：本迁移必须先于新镜像生效**。worker-java 的图片链路是**现查库**读 features
--    （`ImageJobProcessor` → `capabilityMapper.findByModelId`），不是读冻结快照。若新 worker 先上线、
--    本迁移还没跑，图片行里仍带旧键 → 新代码读不到 → 回落 DEFAULT_IMAGE_REFERENCE_MAX = 10：
--    `doubao-seedream-4-0` 会从 4 变 10（过宽）、`gpt-image-2` 从 16 变 10（过紧）。
--    另注：TS 侧能力行有 5 分钟缓存（仅供热路径），迁移后最多 5 分钟才全量刷新。
--
-- ⚠️ 不按 provider_id 过滤：本仓 seed 写的是 'new-api'，线上存量行的 provider_id 实为
--    'volcengine'（早期导入），按 'new-api' 过滤会静默漏改。
--
-- ⚠️ 上线前必跑（pre-flight）。**第一问**列出两键同现且值不同的行，迁移会按行类型自动选值，
--    但**另一个值**可能是运营真正想配的：
--      SELECT id, capability_type, model_id,
--             `features` ->> '$.max_reference_images' AS 旧键,
--             `features` ->> '$.image_reference_max'  AS 新键
--      FROM generation_model_capability
--      WHERE is_delete = 0 AND JSON_TYPE(`features`) = 'OBJECT'
--        AND JSON_CONTAINS_PATH(`features`, 'all', '$.max_reference_images', '$.image_reference_max')
--        AND `features` ->> '$.max_reference_images' <> `features` ->> '$.image_reference_max';
--
--    **第二问更重要**：列出「非音频行、只有新键、没有旧键」的行——这些行的 image_reference_max
--    在本迁移之前**根本不被读**（图片/视频链路读的是旧键），所以它们现在的生效值是缺省 10，
--    迁移后被扶正成配置值，**行为会变**。这正是 seed 里 seedance-2-5 图参考 30 的情形
--    （先前实际生效 10，迁移后 30——这是修复，但请确认每一行的新值是想要的）：
--      SELECT id, capability_type, model_id,
--             `features` ->> '$.image_reference_max' AS 迁移后生效值
--      FROM generation_model_capability
--      WHERE is_delete = 0 AND JSON_TYPE(`features`) = 'OBJECT'
--        AND `capability_type` <> 'audio'
--        AND JSON_CONTAINS_PATH(`features`, 'one', '$.image_reference_max')
--        AND NOT JSON_CONTAINS_PATH(`features`, 'one', '$.max_reference_images');
--
-- 双轨：本文件与 backend/prisma/migrations/20260921090000_ikhexg_reference_key_rename/migration.sql、
--       docs/sql/20260921_ikhexg_reference_key_rename.sql 三处需逐字一致（有 parity 测试断言）。

SET NAMES utf8mb4;

-- 1) 非音频行：旧键（snake_case）→ 新键。两键同现时旧键即本行原本生效的值，直接覆盖。
UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(
      JSON_SET(`features`, '$.image_reference_max',
               JSON_EXTRACT(`features`, '$.max_reference_images')),
      '$.max_reference_images'
    )
WHERE `is_delete` = 0
  AND `capability_type` <> 'audio'
  AND JSON_TYPE(`features`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`features`, 'one', '$.max_reference_images')
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.max_reference_images')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
  AND CAST(`features` ->> '$.max_reference_images' AS SIGNED) >= 0;

-- 2) 非音频行：旧键（camelCase 历史键形）→ 新键。读侧两种键形都认，故库中两种都可能存在。
UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(
      JSON_SET(`features`, '$.image_reference_max',
               JSON_EXTRACT(`features`, '$.maxReferenceImages')),
      '$.maxReferenceImages'
    )
WHERE `is_delete` = 0
  AND `capability_type` <> 'audio'
  AND JSON_TYPE(`features`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`features`, 'one', '$.maxReferenceImages')
  AND JSON_TYPE(JSON_EXTRACT(`features`, '$.maxReferenceImages')) IN ('INTEGER', 'DOUBLE', 'DECIMAL')
  AND CAST(`features` ->> '$.maxReferenceImages' AS SIGNED) >= 0;

-- 3) 残余旧键一律删除：音频行上的旧键本就是死值；上面两条未放行的脏值行也一并清理。
--    脏值行删掉后回落缺省，与读侧 `pickNonNegativeInt` 的降级结果一致——但**仅就新键而言**：
--    旧键的读法没有校验（`f.maxReferenceImages ?? f.max_reference_images ?? 缺省`，原样透出），
--    所以旧键上的负数此前会变成「参考图最多 -5 张」（全都拦死），删掉后回落 10。这是行为改善，
--    但确实是变化——pre-flight 第二问会把这类行的新值一并列出来复核。
UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(`features`, '$.max_reference_images', '$.maxReferenceImages')
WHERE `is_delete` = 0
  AND JSON_TYPE(`features`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`features`, 'one', '$.max_reference_images', '$.maxReferenceImages');
