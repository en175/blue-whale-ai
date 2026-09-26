-- IKHUES 图片模型尺寸矩阵补齐 —— 变更快照
-- 工单：IKHUES    日期：2026-09-22
-- 性质：纯数据补全。不改代码、不改 channel_parser；supported_sizes 仅 doubao-seedream-5-0-pro-260628 一行被修正。
-- 执行方式：由人工在测试站 blue_whale 直接执行（不走 prisma 迁移）。
--
-- 本文件是**变更记录**，记录实际生效的语句与执行前的原值；如需回滚，按下面的「执行前原值」写回即可。
--
-- ============================================================================
-- 口径：seedream 与 gpt 的矩阵键不是同一个东西
-- ============================================================================
-- seedream：worker 先按 supported_sizes[].id 命中条目，取该条目的 **api_value** 当 providerSize，
--           再用它当矩阵查找键（ImageChannelMapper.matchSupportedSize / resolveSeedreamSize）。
--           所以 **seedream 的矩阵键必须等于 api_value**，而不是 id。
-- gpt     ：矩阵键就是用户选的尺寸 **id**（mapImageChannelRequest(mapping, sizeOptionId, ratioId)）。
-- 两条链的查表都大小写不敏感，所以拼写差异不会立刻出事——但那是兜底，不是口径。
--
-- 另有一条既有事实（本次未改，供排查）：
--   capability.getApiSize() 恒为 null —— Java 实体声明了 api_size/width/height 三个 @TableField，
--   但 generation_model_capability 表里没有这三列，mapper 是 SELECT *，映射不到即 null。
--   因此 seedream 档位若没有 api_value，providerSize 为 null，整个 seedream 矩阵分支被跳过
--   （ImageJobProcessor 的条件是 providerSize != null && aspectRatio != null && hasSizeMatrix(...)）。
--
-- ============================================================================
-- 执行前原值（回滚依据）
-- ============================================================================
-- SELECT id, provider_id, model_id, request_mapping FROM `generation_model_capability`
-- WHERE capability_type = 'image' AND is_delete = 0
--   AND model_id IN ('gpt-image-2','gpt-image-2-light','doubao-seedream-5-0-pro-260628');
--
--   gpt-image-2（id=30, new-api）     矩阵 18 格：1k{1:1,2:3,3:2} 2k{全部 13 格} 4k{16:9,9:16}
--   gpt-image-2-light（id=31, new-api）矩阵 15 格：1k{5 格 auto} 2k{8 格 auto} 4k{2 格 auto}
--   doubao-seedream-5-0-pro-260628（id=13, volcengine）
--     supported_sizes: [{id:'1k',label:'1K',api_value:'1K'}, {id:'1.5',label:'1.5'}, {id:'2',label:'2'}]
--     request_mapping: {"matrix":{"1K":{8 比例},"2K":{8 比例}}}
--     default_size: '2k'（对不上任何一档 id）
--
---- ============================================================================
-- 变更一：gpt 两行空档填 auto
-- ============================================================================
-- 空缺组合在消费侧会回落「默认档 × 默认比例」那一格（default_size='2k'、default_aspect_ratio='1:1'），
-- 于是用户选 1K × 4:3 实际拿到 2048x2048 —— 档位与比例都是错的。填空档后由上游按 size="auto" 决定。
-- auto 是官方合法取值（gpt-image-2 官方只给尺寸约束，不给枚举档位表）。
-- 原有的显式像素值逐格保留，只补空档：gpt-image-2 补 21 格、gpt-image-2-light 补 9 格。

UPDATE `generation_model_capability`
SET `request_mapping` = CAST('{"matrix": {"1k": {"1:1": "1024x1024", "1:2": "auto", "1:3": "auto", "2:1": "auto", "2:3": "1024x1536", "3:1": "auto", "3:2": "1536x1024", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto", "9:21": "auto"}, "2k": {"1:1": "2048x2048", "1:2": "1024x2048", "1:3": "688x2048", "2:1": "2048x1024", "2:3": "1360x2048", "3:1": "2048x688", "3:2": "2048x1360", "3:4": "1536x2048", "4:3": "2048x1536", "16:9": "2048x1152", "21:9": "2048x880", "9:16": "1152x2048", "9:21": "880x2048"}, "4k": {"1:1": "auto", "1:2": "auto", "1:3": "auto", "2:1": "auto", "2:3": "auto", "3:1": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "3840x2160", "21:9": "auto", "9:16": "2160x3840", "9:21": "auto"}}}' AS JSON)
WHERE `capability_type` = 'image' AND `provider_id` = 'new-api'
  AND `model_id` = 'gpt-image-2' AND `channel_parser` = 'gpt' AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `request_mapping` = CAST('{"matrix": {"1k": {"1:1": "auto", "2:3": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto"}, "2k": {"1:1": "auto", "2:3": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto"}, "4k": {"1:1": "auto", "2:3": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto"}}}' AS JSON)
WHERE `capability_type` = 'image' AND `provider_id` = 'new-api'
  AND `model_id` = 'gpt-image-2-light' AND `channel_parser` = 'gpt' AND `is_delete` = 0;

-- ============================================================================
-- 变更二：doubao-seedream-5-0-pro-260628 档位与矩阵对齐（A 方案：三处一起规整）
-- ============================================================================
-- 原行三处互相矛盾：id 是 1k/1.5/2、api_value 只有第一条有、矩阵键是 2K、default_size 是 2k。
-- 后果：选 1.5 或 2 时没有任何 api_value → providerSize 为 null → seedream 分支整段跳过，
--       矩阵里那行 2K 永远不会被读，出站尺寸为空。
--
-- 1.5K 档 8 格像素值取自火山方舟官方档位表；同表的 1K / 2K 共 16 个值与库中现值**逐字一致**，
-- 故同表的 1.5K 可信：
--   1:1  1536x1536    4:3  1792x1344    3:4  1344x1792    16:9 2048x1152
--   9:16 1152x2048    3:2  1872x1248    2:3  1248x1872    21:9 2352x1008

UPDATE `generation_model_capability`
SET `supported_sizes` = JSON_ARRAY(
  JSON_OBJECT('id', '1k',   'label', '1K',   'api_value', '1K'),
  JSON_OBJECT('id', '1.5k', 'label', '1.5K', 'api_value', '1.5K'),
  JSON_OBJECT('id', '2k',   'label', '2K',   'api_value', '2K')
)
WHERE `capability_type` = 'image' AND `provider_id` = 'volcengine'
  AND `model_id` = 'doubao-seedream-5-0-pro-260628' AND `channel_parser` = 'seedream' AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `request_mapping` = CAST('{"matrix": {"1k": {"1:1": "1024x1024", "2:3": "832x1248", "3:2": "1248x832", "3:4": "864x1152", "4:3": "1152x864", "16:9": "1424x800", "21:9": "1568x672", "9:16": "800x1424"}, "2k": {"1:1": "2048x2048", "2:3": "1664x2496", "3:2": "2496x1664", "3:4": "1776x2368", "4:3": "2368x1776", "16:9": "2816x1584", "21:9": "3136x1344", "9:16": "1584x2816"}, "1.5k": {"1:1": "1536x1536", "2:3": "1248x1872", "3:2": "1872x1248", "3:4": "1344x1792", "4:3": "1792x1344", "16:9": "2048x1152", "21:9": "2352x1008", "9:16": "1152x2048"}}}' AS JSON)
WHERE `capability_type` = 'image' AND `provider_id` = 'volcengine'
  AND `model_id` = 'doubao-seedream-5-0-pro-260628' AND `channel_parser` = 'seedream' AND `is_delete` = 0;

-- ============================================================================
-- 刻意未改
-- ============================================================================
-- doubao-seedream-4-0-250828 / 4-5-251128 / 5-0-260128
--   矩阵键与各自档位的 api_value 本来就一致（1K/2K/4K 等），8 个比例齐全，无需改动。
--   曾有方案要把键改成小写去「对齐 id」——方向是错的，按 id 改键会打断 worker 的查找。
-- doubao-seedream-3-0-t2i-250415
--   档位值本身即像素尺寸、矩阵为 NULL，直传即合法。
-- banana 三行
--   一维映射（quality / size），不吃矩阵。

-- ============================================================================
-- 复查
-- ============================================================================
-- SELECT model_id, provider_id, default_size,
--        JSON_KEYS(JSON_EXTRACT(request_mapping,'$.matrix')) AS matrix_keys
-- FROM `generation_model_capability`
-- WHERE capability_type = 'image' AND is_delete = 0
--   AND channel_parser IN ('seedream','gpt')
-- ORDER BY id;
--
-- 预期：seedream 各行矩阵键 == 该行各档位的 api_value；
--       两个 gpt 行矩阵键 == supported_sizes[].id（1k/2k/4k），且每档覆盖全部 supported_aspect_ratios。
