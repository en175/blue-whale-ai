
UPDATE `generation_model_capability`
SET `request_mapping` = CAST('{"matrix": {"1k": {"1:1": "1024x1024", "1:2": "auto", "1:3": "auto", "2:1": "auto", "2:3": "1024x1536", "3:1": "auto", "3:2": "1536x1024", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto", "9:21": "auto"}, "2k": {"1:1": "2048x2048", "1:2": "1024x2048", "1:3": "688x2048", "2:1": "2048x1024", "2:3": "1360x2048", "3:1": "2048x688", "3:2": "2048x1360", "3:4": "1536x2048", "4:3": "2048x1536", "16:9": "2048x1152", "21:9": "2048x880", "9:16": "1152x2048", "9:21": "880x2048"}, "4k": {"1:1": "auto", "1:2": "auto", "1:3": "auto", "2:1": "auto", "2:3": "auto", "3:1": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "3840x2160", "21:9": "auto", "9:16": "2160x3840", "9:21": "auto"}}}' AS JSON)
WHERE `capability_type` = 'image' AND `provider_id` = 'new-api'
  AND `model_id` = 'gpt-image-2' AND `channel_parser` = 'gpt' AND `is_delete` = 0;

UPDATE `generation_model_capability`
SET `request_mapping` = CAST('{"matrix": {"1k": {"1:1": "auto", "2:3": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto"}, "2k": {"1:1": "auto", "2:3": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto"}, "4k": {"1:1": "auto", "2:3": "auto", "3:2": "auto", "3:4": "auto", "4:3": "auto", "16:9": "auto", "21:9": "auto", "9:16": "auto"}}}' AS JSON)
WHERE `capability_type` = 'image' AND `provider_id` = 'new-api'
  AND `model_id` = 'gpt-image-2-light' AND `channel_parser` = 'gpt' AND `is_delete` = 0;


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
