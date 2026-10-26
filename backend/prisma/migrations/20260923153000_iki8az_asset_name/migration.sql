-- IKI8AZ：保存上传原文件名，供资产列表及详情展示；旧资产允许为空。
SET NAMES utf8mb4;

ALTER TABLE `assets` ADD COLUMN `name` VARCHAR(255) NULL AFTER `type`;
