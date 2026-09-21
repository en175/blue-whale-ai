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
-- 本迁移做三件事（**只搬值、不改语义**）：
--   (1) 非音频行：把旧键 `max_reference_images` 的值搬进 `image_reference_max`，删旧键；
--   (2) 同上，兼容 camelCase 历史键形 `maxReferenceImages`；
--   (3) 残余旧键一律删除——音频行上的旧键本来就是死值（音频链路读的是 `image_reference_max`）。
-- 三步之后代码里 `max_reference_images` 不再有生产者，库里的遗留值也被清掉。
--
-- ⚠️ 判定「哪个值原本生效」的依据是**行类型**：行的 capability_type 决定哪把键被读，因此两键
--    同现时保留原本被读的那把，行为逐字不变。这一点机器能安全推断（不是猜语义）。
--
-- ⚠️ 不按 provider_id 过滤：本仓 seed 写的是 'new-api'，线上存量行的 provider_id 实为
--    'volcengine'（早期导入），按 'new-api' 过滤会静默漏改。
--
-- ⚠️ 上线前必跑（pre-flight）：列出两键同现且值不同的行。迁移会按行类型自动选值，
--    但**另一个值**可能是运营真正想配的，值得人工过一眼再上线：
--      SELECT id, capability_type, model_id,
--             `features` ->> '$.max_reference_images' AS 旧键,
--             `features` ->> '$.image_reference_max'  AS 新键
--      FROM generation_model_capability
--      WHERE is_delete = 0 AND JSON_TYPE(`features`) = 'OBJECT'
--        AND JSON_CONTAINS_PATH(`features`, 'all', '$.max_reference_images', '$.image_reference_max')
--        AND `features` ->> '$.max_reference_images' <> `features` ->> '$.image_reference_max';
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

-- 3) 残余旧键一律删除：音频行上的旧键本就是死值；上面两条未放行的脏值行也一并清理
--    （非法值本就被读侧 `pickNonNegativeInt` 降级为缺省，删掉与降级等价）。
UPDATE `generation_model_capability`
SET `features` = JSON_REMOVE(`features`, '$.max_reference_images', '$.maxReferenceImages')
WHERE `is_delete` = 0
  AND JSON_TYPE(`features`) = 'OBJECT'
  AND JSON_CONTAINS_PATH(`features`, 'one', '$.max_reference_images', '$.maxReferenceImages');
