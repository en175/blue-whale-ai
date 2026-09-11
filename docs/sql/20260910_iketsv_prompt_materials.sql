-- IKETSV / 2026-09-10：不可变预览保存完整素材身份和正文标签绑定。
ALTER TABLE `prompt_preview_snapshots` ADD COLUMN `content_json` JSON NULL;
