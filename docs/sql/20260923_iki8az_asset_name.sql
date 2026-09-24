-- IKI8AZ，2026-09-23：为资产增加上传原文件名，旧行保持 NULL。
ALTER TABLE `assets` ADD COLUMN `name` VARCHAR(255) NULL AFTER `type`;
