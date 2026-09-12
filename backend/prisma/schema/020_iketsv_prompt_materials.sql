-- IKETSV: preserve immutable prompt material identity and mention ranges.
ALTER TABLE `prompt_preview_snapshots` ADD COLUMN `content_json` JSON NULL;
