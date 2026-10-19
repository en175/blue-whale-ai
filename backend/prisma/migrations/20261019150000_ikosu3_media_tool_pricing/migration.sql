SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `media_tool_pricing` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tool_type` VARCHAR(64) NOT NULL,
  `label` VARCHAR(64) NOT NULL,
  `pricing` JSON NOT NULL,
  `version` INT NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `charge_enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `gmt_create` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `gmt_modified` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
  `is_delete` BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_media_tool_pricing__tool_type` (`tool_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `media_tool_pricing`
  (`tool_type`, `label`, `pricing`, `version`, `enabled`, `charge_enabled`)
VALUES
('image_enhance', '高清放大', CAST('{"baseUnit":"constant:1","basePrice":{"kind":"table","by":["multiple"],"table":{"multiple=2":15000,"multiple=4":47000,"multiple=6":67000}},"unitDenominator":1,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('image_outpaint', '智能扩图', CAST('{"baseUnit":"constant:1","basePrice":{"kind":"const","value":14000},"unitDenominator":1,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('image_erase', '智能擦除', CAST('{"baseUnit":"constant:1","basePrice":{"kind":"const","value":14000},"unitDenominator":1,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('image_cutout', '智能抠图', CAST('{"baseUnit":"constant:1","basePrice":{"kind":"const","value":1000},"unitDenominator":1,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('video_enhance', 'HD 高清', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"table","by":["resolution"],"table":{"resolution=1080p":4000,"resolution=2k":7000,"resolution=4k":15000}},"quantityOffset":1,"unitDenominator":1,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('video_frame_interpolation', '智能插帧', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"table","by":["fps"],"table":{"fps=30":45000,"fps=60":90000,"fps=120":180000}},"quantityOffset":1,"quantityStep":5,"unitDenominator":60,"minCredits":1,"rounding":"ceil"}' AS JSON), 0, TRUE, TRUE),
('video_matting', '智能抠像', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":200},"quantityOffset":1,"quantityStep":5,"unitDenominator":1,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('video_subtitle_erase', '智能去字幕', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":38000},"quantityOffset":1,"quantityStep":5,"unitDenominator":60,"minCredits":1,"rounding":"ceil"}' AS JSON), 0, TRUE, TRUE),
('video_scene_split', '场景切分', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":1000},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('vocal_split', '人声背景分离', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":3000},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('media_extract', '音频提取', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":1000},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('audio_trim', '音频截取', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":1000},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('audio_mix', '音频混合', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":1000},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('audio_speed', '音频调速', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"const","value":1000},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE),
('audio_video_mux', '音视频合流', CAST('{"baseUnit":"usage.seconds","basePrice":{"kind":"table","by":["resolution"],"table":{"resolution=1080p":3000,"resolution=2k":5000,"resolution=4k":9000}},"quantityStep":60,"unitDenominator":60,"minCredits":1}' AS JSON), 0, TRUE, TRUE);
