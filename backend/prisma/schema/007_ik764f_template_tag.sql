SET NAMES utf8mb4;
CREATE TABLE `template_tag` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `tag_code` VARCHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `create_time` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `update_time` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `is_delete` TINYINT NOT NULL DEFAULT 0,

    UNIQUE INDEX `uk_tag_code`(`tag_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `template_tag` (`tag_code`, `label`, `sort_order`) VALUES
    ('marketing', '营销视频', 0),
    ('short', '微短片', 1),
    ('replicate', '视频复刻', 2),
    ('social', '社媒视频', 3),
    ('image', '图片设计', 4);
