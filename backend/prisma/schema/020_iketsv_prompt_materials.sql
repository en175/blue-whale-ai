-- 020_iketsv_prompt_materials：schema 基线片段。
SET NAMES utf8mb4;

-- IKETSV: preserve immutable prompt material identity and mention ranges.
ALTER TABLE `prompt_preview_snapshots` ADD COLUMN `content_json` JSON NULL;
