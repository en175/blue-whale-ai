SET NAMES utf8mb4;
ALTER TABLE `catalog_media_tools` RENAME INDEX `uk_catalog_media_tools__tool_type` TO `uk_bw_media_tools__tool_type`;
RENAME TABLE `catalog_media_tools` TO `bw_media_tools`;
DROP TABLE IF EXISTS `agent_runs`;
