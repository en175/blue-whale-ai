-- IKA64P：首页模板标签可见性开关（隐藏原五栏，新增视频/图片两栏）。
ALTER TABLE `template_tag` ADD COLUMN `visible` TINYINT NOT NULL DEFAULT 1;

UPDATE `template_tag` SET `visible` = 0
WHERE `tag_code` IN ('marketing', 'short', 'replicate', 'social', 'image');

INSERT INTO `template_tag` (`tag_code`, `label`, `sort_order`, `visible`) VALUES
    ('video', '视频', 5, 1),
    ('picture', '图片', 6, 1);
