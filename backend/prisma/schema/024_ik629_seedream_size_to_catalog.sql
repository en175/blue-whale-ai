SET NAMES utf8mb4;

-- IK629：seedream 尺寸映射从代码硬编码迁入 generation_model_capability.request_mapping。
--
-- 背景：IKDBYY 引入 channel_parser + request_mapping 时，gpt 矩阵与 banana 双表都写进了能力行，
-- 唯独 seedream 的「分辨率 × 宽高比 → WxH」表留在 worker 代码里（ImageChannelMapper.MODEL_SIZES，
-- 写死 4 个模型名）。后果：上游新增/调整模型尺寸必须改 Java 代码并重新发版；且 seedream 行
-- 的 supported_sizes.api_value 只是 '1K' 这类档位名，上游并不接受（实测 400 Invalid size），
-- 真值实际由代码表展开——即「数据库里的值不可用，真值在代码里」，违背契约 §12「协议由能力行声明」。
--
-- 本迁移把 4 个启用中的 seedream 行的尺寸表原样写入 request_mapping.matrix（形状与 gpt 行一致），
-- worker 侧改读能力行、删除代码表。逐格取自迁移前的 MODEL_SIZES，行为等价。
-- 与 prisma/migrations/20260912120000_ik629_seedream_size_to_catalog/migration.sql 双轨同步。

-- doubao-seedream-5-0-pro-260628
UPDATE `generation_model_capability` SET `request_mapping` = CAST('{"matrix":{"1K":{"1:1":"1024x1024","4:3":"1152x864","3:4":"864x1152","16:9":"1424x800","9:16":"800x1424","3:2":"1248x832","2:3":"832x1248","21:9":"1568x672"},"2K":{"1:1":"2048x2048","4:3":"2368x1776","3:4":"1776x2368","16:9":"2816x1584","9:16":"1584x2816","3:2":"2496x1664","2:3":"1664x2496","21:9":"3136x1344"}}}' AS JSON)
  WHERE `model_id` = 'doubao-seedream-5-0-pro-260628' AND `is_delete` = 0;

-- doubao-seedream-5-0-260128
UPDATE `generation_model_capability` SET `request_mapping` = CAST('{"matrix":{"2K":{"1:1":"2048x2048","4:3":"2304x1728","3:4":"1728x2304","16:9":"2848x1600","9:16":"1600x2848","3:2":"2496x1664","2:3":"1664x2496","21:9":"3136x1344"},"3K":{"1:1":"3072x3072","4:3":"3456x2592","3:4":"2592x3456","16:9":"4096x2304","9:16":"2304x4096","3:2":"3744x2496","2:3":"2496x3744","21:9":"4704x2016"},"4K":{"1:1":"4096x4096","4:3":"4704x3520","3:4":"3520x4704","16:9":"5504x3040","9:16":"3040x5504","3:2":"4992x3328","2:3":"3328x4992","21:9":"6240x2656"}}}' AS JSON)
  WHERE `model_id` = 'doubao-seedream-5-0-260128' AND `is_delete` = 0;

-- doubao-seedream-4-5-251128
UPDATE `generation_model_capability` SET `request_mapping` = CAST('{"matrix":{"2K":{"1:1":"2048x2048","4:3":"2304x1728","3:4":"1728x2304","16:9":"2848x1600","9:16":"1600x2848","3:2":"2496x1664","2:3":"1664x2496","21:9":"3136x1344"},"4K":{"1:1":"4096x4096","4:3":"4704x3520","3:4":"3520x4704","16:9":"5504x3040","9:16":"3040x5504","3:2":"4992x3328","2:3":"3328x4992","21:9":"6240x2656"}}}' AS JSON)
  WHERE `model_id` = 'doubao-seedream-4-5-251128' AND `is_delete` = 0;

-- doubao-seedream-4-0-250828
UPDATE `generation_model_capability` SET `request_mapping` = CAST('{"matrix":{"1K":{"1:1":"1024x1024","4:3":"1152x864","3:4":"864x1152","16:9":"1312x736","9:16":"736x1312","3:2":"1248x832","2:3":"832x1248","21:9":"1568x672"},"2K":{"1:1":"2048x2048","4:3":"2304x1728","3:4":"1728x2304","16:9":"2848x1600","9:16":"1600x2848","3:2":"2496x1664","2:3":"1664x2496","21:9":"3136x1344"},"4K":{"1:1":"4096x4096","4:3":"4704x3520","3:4":"3520x4704","16:9":"5504x3040","9:16":"3040x5504","3:2":"4992x3328","2:3":"3328x4992","21:9":"6240x2656"}}}' AS JSON)
  WHERE `model_id` = 'doubao-seedream-4-0-250828' AND `is_delete` = 0;
